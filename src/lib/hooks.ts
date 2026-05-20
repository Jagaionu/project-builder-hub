import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Driver, Warehouse, Job } from "@/lib/types";
import { computeCompliance, type Compliance, type ComplianceEvent } from "@/lib/compliance";

export function useDrivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  useEffect(() => {
    let mounted = true;
    supabase.from("drivers").select("*").order("name").then(({ data }) => {
      if (mounted && data) setDrivers(data as Driver[]);
    });
    const ch = supabase.channel("rt-drivers")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, (payload) => {
        setDrivers((prev) => {
          if (payload.eventType === "INSERT") return [...prev, payload.new as Driver];
          if (payload.eventType === "UPDATE")
            return prev.map((d) => (d.id === (payload.new as Driver).id ? (payload.new as Driver) : d));
          if (payload.eventType === "DELETE")
            return prev.filter((d) => d.id !== (payload.old as Driver).id);
          return prev;
        });
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);
  return drivers;
}

export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  useEffect(() => {
    supabase.from("warehouses").select("*").order("code").then(({ data }) => {
      if (data) setWarehouses(data as Warehouse[]);
    });
  }, []);
  return warehouses;
}

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    let mounted = true;
    supabase.from("jobs").select("*").order("created_at", { ascending: false }).then(({ data }) => {
      if (mounted && data) setJobs(data as Job[]);
    });
    const ch = supabase.channel("rt-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, (payload) => {
        setJobs((prev) => {
          if (payload.eventType === "INSERT") return [payload.new as Job, ...prev];
          if (payload.eventType === "UPDATE")
            return prev.map((j) => (j.id === (payload.new as Job).id ? (payload.new as Job) : j));
          if (payload.eventType === "DELETE")
            return prev.filter((j) => j.id !== (payload.old as Job).id);
          return prev;
        });
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);
  return jobs;
}

export function useDriverEventsByDriver(): Record<string, ComplianceEvent[]> {
  const [map, setMap] = useState<Record<string, ComplianceEvent[]>>({});
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
      setMap(m);
    };
    load();
    const ch = supabase
      .channel("rt-driver-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "driver_events" }, load)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return map;
}

export function useCompliance(): Record<string, Compliance> {
  const events = useDriverEventsByDriver();
  // Tick every minute so headroom / break timers stay current.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => {
    const now = Date.now();
    void tick;
    const out: Record<string, Compliance> = {};
    for (const [driverId, evs] of Object.entries(events)) {
      out[driverId] = computeCompliance(evs, now);
    }
    return out;
  }, [events, tick]);
}
