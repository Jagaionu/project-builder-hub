import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Driver, Warehouse, Job } from "@/lib/types";
import { computeCompliance, type Compliance, type ComplianceEvent } from "@/lib/compliance";
import { useActiveJobsByDriver } from "@/lib/use-driver-routes";
import { projectedRouteDriveMinutes, effectiveDriverStatus } from "@/lib/effective-status";

// Coalesce bursty realtime triggers so a flurry of inserts/updates from the
// server doesn't fire N back-to-back full-table reloads. ~300ms feels instant
// to a user but collapses dozens of events into one DB round trip.
function debounce<T extends (...args: never[]) => void>(fn: T, ms = 300): T {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

// Module-level caches so navigating between routes doesn't briefly flash
// empty state while data re-loads. Each hook seeds initial state from cache
// and writes back on every update.
const cache: {
  drivers: Driver[];
  warehouses: Warehouse[];
  jobs: Job[];
  driverEvents: Record<string, ComplianceEvent[]>;
  recentDelays: RecentDelay[];
  driverDayHours: Record<string, DriverDayHours[]>;
} = {
  drivers: [],
  warehouses: [],
  jobs: [],
  driverEvents: {},
  recentDelays: [],
  driverDayHours: {},
};

export function useDrivers(initialDrivers: Driver[] = []) {
  const [drivers, setDrivers] = useState<Driver[]>(
    cache.drivers.length ? cache.drivers : initialDrivers,
  );
  const channelNameRef = useRef(`rt-drivers-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    let mounted = true;
    supabase.from("drivers").select("*").order("name").then(({ data }) => {
      if (mounted && data) {
        cache.drivers = data as Driver[];
        setDrivers(cache.drivers);
      }
    });
    const ch = supabase.channel(channelNameRef.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, (payload) => {
        setDrivers((prev) => {
          let next = prev;
          if (payload.eventType === "INSERT") next = [...prev, payload.new as Driver].sort((a, b) => a.name.localeCompare(b.name));
          else if (payload.eventType === "UPDATE")
            next = prev.map((d) => (d.id === (payload.new as Driver).id ? (payload.new as Driver) : d)).sort((a, b) => a.name.localeCompare(b.name));
          else if (payload.eventType === "DELETE")
            next = prev.filter((d) => d.id !== (payload.old as Driver).id).sort((a, b) => a.name.localeCompare(b.name));
          cache.drivers = next;
          return next;
        });
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);
  return drivers;
}

export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>(cache.warehouses);
  useEffect(() => {
    supabase.from("warehouses").select("*").order("code").then(({ data }) => {
      if (data) {
        cache.warehouses = data as Warehouse[];
        setWarehouses(cache.warehouses);
      }
    });
  }, []);
  return warehouses;
}

// Module-level fan-out so any mutation site can push optimistic updates into
// every mounted useJobs() subscriber without waiting for the realtime echo.
const jobsSubscribers = new Set<(jobs: Job[]) => void>();
function broadcastJobs(next: Job[]) {
  cache.jobs = next;
  for (const fn of jobsSubscribers) fn(next);
}
export function applyJobPatch(jobId: string, patch: Partial<Job>) {
  const next = cache.jobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j));
  broadcastJobs(next);
}

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>(cache.jobs);
  const channelNameRef = useRef(`rt-jobs-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    jobsSubscribers.add(setJobs);
    let mounted = true;
    // Bounded window: last 30 days + future + any unscheduled.
    // Avoids fetching the entire jobs history (which grew linearly with usage).
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    supabase
      .from("jobs")
      .select("*")
      .or(`for_date.gte.${since},for_date.is.null`)
      .order("created_at", { ascending: false })
      .limit(2000)
      .then(({ data }) => {
        if (mounted && data) broadcastJobs(data as Job[]);
      });
    const ch = supabase.channel(channelNameRef.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, (payload) => {
        let next = cache.jobs;
        if (payload.eventType === "INSERT") next = [payload.new as Job, ...cache.jobs];
        else if (payload.eventType === "UPDATE")
          next = cache.jobs.map((j) => (j.id === (payload.new as Job).id ? (payload.new as Job) : j));
        else if (payload.eventType === "DELETE")
          next = cache.jobs.filter((j) => j.id !== (payload.old as Job).id);
        broadcastJobs(next);
      })
      .subscribe();
    return () => {
      mounted = false;
      jobsSubscribers.delete(setJobs);
      supabase.removeChannel(ch);
    };
  }, []);
  return jobs;
}

export function useDriverEventsByDriver(): Record<string, ComplianceEvent[]> {
  const [map, setMap] = useState<Record<string, ComplianceEvent[]>>(cache.driverEvents);
  const channelNameRef = useRef(`rt-driver-events-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    let mounted = true;
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const load = async () => {
      const { data } = await supabase
        .from("driver_events")
        .select("driver_id,type,timestamp")
        .in("type", ["START_SHIFT", "END_SHIFT"])
        .gte("timestamp", since)
        .order("timestamp", { ascending: true });
      if (!mounted || !data) return;
      const m: Record<string, ComplianceEvent[]> = {};
      for (const e of data as Array<{ driver_id: string; type: string; timestamp: string }>) {
        (m[e.driver_id] ||= []).push({ type: e.type, timestamp: e.timestamp });
      }
      cache.driverEvents = m;
      setMap(m);
    };
    load();
    const debouncedLoad = debounce(load, 500);
    const ch = supabase
      .channel(channelNameRef.current)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "driver_events" }, debouncedLoad)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return map;
}

export type RecentDelay = {
  driver_id: string;
  timestamp: string;
  reason: string;
  job_id?: string;
};

export function useRecentDelays(): RecentDelay[] {
  const [rows, setRows] = useState<RecentDelay[]>(cache.recentDelays);
  const channelNameRef = useRef(`rt-delay-events-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("driver_events")
        .select("driver_id,timestamp,payload")
        .eq("type", "DELAY_REPORT" as never)
        .gte("timestamp", since)
        .order("timestamp", { ascending: false });
      if (!mounted || !data) return;
      const next = (data as Array<{ driver_id: string; timestamp: string; payload: { reason?: string; category?: string; notes?: string; note?: string; job_id?: string } }>).map(
        (r) => {
          const headline = r.payload?.reason ?? r.payload?.category ?? "Delay reported";
          const extra = (r.payload?.notes ?? r.payload?.note ?? "").trim();
          return {
            driver_id: r.driver_id,
            timestamp: r.timestamp,
            reason: extra ? `${headline} — ${extra}` : headline,
            job_id: r.payload?.job_id,
          };
        },
      );

      cache.recentDelays = next;
      setRows(next);
    };
    load();
    const debouncedLoad = debounce(load, 500);
    const ch = supabase
      .channel(channelNameRef.current)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "driver_events" }, debouncedLoad)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return rows;
}

export type DriverDayHours = {
  driver_id: string;
  day: string;            // YYYY-MM-DD
  shift_minutes: number;
  drive_minutes: number;
  off_minutes: number;
  week_start: string;     // YYYY-MM-DD
};

export function useDriverDayHours(): Record<string, DriverDayHours[]> {
  const [map, setMap] = useState<Record<string, DriverDayHours[]>>(cache.driverDayHours);
  const channelNameRef = useRef(`rt-driver-day-hours-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const since = new Date(Date.now() - 21 * 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);
        const { data, error } = await supabase
          .from("driver_day_hours")
          .select("driver_id,day,shift_minutes,drive_minutes,off_minutes,week_start")
          .gte("day", since)
          .order("day", { ascending: false });

        if (error) {
          console.error("[drivers][day-hours] failed to load", {
            message: error.message,
            code: error.code,
            details: error.details,
          });
          return;
        }

        if (!mounted || !data) return;
        const m: Record<string, DriverDayHours[]> = {};
        for (const r of data as DriverDayHours[]) {
          (m[r.driver_id] ||= []).push(r);
        }
        cache.driverDayHours = m;
        setMap(m);
      } catch (error) {
        console.error("[drivers][day-hours] unexpected hook error", error);
      }
    };
    load();

    const debouncedLoad = debounce(() => void load(), 500);
    const ch = supabase
      .channel(channelNameRef.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_day_hours" }, debouncedLoad)
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return map;
}

function useComplianceState(
  events: Record<string, ComplianceEvent[]>,
  ledger: Record<string, DriverDayHours[]>,
): Record<string, Compliance> {
  // Tick every minute so headroom / break timers stay current.
  const [tick, setTick] = useState(0);
  const activeJobsByDriver = useActiveJobsByDriver();
  const drivers = useDrivers();

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const now = Date.now();
    void tick;
    const today = ukDayStringLocal(new Date(now));
    const weekAgo = ukDayStringLocal(new Date(now - 6 * 24 * 3600 * 1000));
    const fortnightAgo = ukDayStringLocal(new Date(now - 13 * 24 * 3600 * 1000));
    const out: Record<string, Compliance> = {};
    const driverIds = new Set([
      ...Object.keys(events),
      ...Object.keys(ledger),
      ...Object.keys(activeJobsByDriver),
    ]);

    for (const driverId of driverIds) {
      const evs = events[driverId] ?? [];
      const rows = ledger[driverId] ?? [];
      const activeJobs = activeJobsByDriver[driverId] ?? [];
      const driver = drivers.find((d) => d.id === driverId);

      const todayRow = rows.find((r) => r.day === today);
      const weekRows = rows.filter((r) => r.day >= weekAgo && r.day <= today);
      const fortRows = rows.filter((r) => r.day >= fortnightAgo && r.day <= today);

      // Calculate continuous drive from active routes if the driver is actually ON_ROUTE
      let continuousDrive = 0;
      const status = driver
        ? effectiveDriverStatus(driver.status, activeJobs, now)
        : "OFF_SHIFT";
      if (status === "ON_ROUTE") {
        for (const job of activeJobs) {
          const proj = projectedRouteDriveMinutes(
            job,
            driver?.current_lat ?? null,
            driver?.current_lon ?? null,
          );
          continuousDrive += proj.totalMin / 60;
        }
      }

      const totals = {
        daily: todayRow ? todayRow.drive_minutes / 60 : undefined,
        weekly: weekRows.length
          ? weekRows.reduce((s, r) => s + r.drive_minutes, 0) / 60
          : undefined,
        twoWeek: fortRows.length
          ? fortRows.reduce((s, r) => s + r.drive_minutes, 0) / 60
          : undefined,
        continuousDrive,
      };
      out[driverId] = computeCompliance(evs, now, totals);
    }
    return out;
  }, [events, ledger, tick, activeJobsByDriver, drivers]);
}

function ukDayStringLocal(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function useCompliance(): Record<string, Compliance> {
  const events = useDriverEventsByDriver();
  const ledger = useDriverDayHours();
  return useComplianceState(events, ledger);
}

export function useComplianceWithLedger(
  ledger: Record<string, DriverDayHours[]>,
): Record<string, Compliance> {
  const events = useDriverEventsByDriver();
  return useComplianceState(events, ledger);
}
