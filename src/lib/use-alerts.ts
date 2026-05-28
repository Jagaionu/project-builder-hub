import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Gauge, Timer, MapPin, RefreshCcw, Clock, type LucideIcon } from "lucide-react";
import { useCompliance, useDrivers, useJobs, useRecentDelays } from "@/lib/hooks";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { ackAlert } from "./alerts.functions";
import { toast } from "sonner";

type CantCompleteEvent = {
  id: string;
  timestamp: string;
  payload: { job_reference?: string; driver_name?: string; reason?: string };
};

function useRecentCantComplete(): CantCompleteEvent[] {
  const [rows, setRows] = useState<CantCompleteEvent[]>([]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("driver_events")
        .select("id,timestamp,payload")
        .eq("type", "CANT_COMPLETE" as never)
        .gte("timestamp", since)
        .order("timestamp", { ascending: false });
      if (!mounted || !data) return;
      setRows(data as unknown as CantCompleteEvent[]);
    };
    load();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => void load(), 400);
    };
    const ch = supabase
      .channel(`rt-cant-complete-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "driver_events" }, debounced)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return rows;
}

type ParkedImport = {
  id: string;
  reference: string;
  lane: string;
  missing_codes: string[];
};

function useParkedImports(): ParkedImport[] {
  const [rows, setRows] = useState<ParkedImport[]>([]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("pending_job_imports" as never)
        .select("id,reference,lane,missing_codes")
        .order("created_at", { ascending: false });
      if (!mounted || !data) return;
      setRows(data as unknown as ParkedImport[]);
    };
    load();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => void load(), 400);
    };
    const ch = supabase
      .channel(`rt-parked-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_job_imports" }, debounced)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return rows;
}


type ReimportAlert = {
  id: string;
  reference: string;
  lane: string;
  uploaded_at: string;
};

function useReimportAlerts(): ReimportAlert[] {
  const [rows, setRows] = useState<ReimportAlert[]>([]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("reimport_alerts" as never)
        .select("id,reference,lane,uploaded_at")
        .order("uploaded_at", { ascending: false });
      if (!mounted || !data) return;
      setRows(data as unknown as ReimportAlert[]);
    };
    load();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => void load(), 400);
    };
    const ch = supabase
      .channel(`rt-reimport-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reimport_alerts" }, debounced)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return rows;
}

export interface AppAlert {
  id: string;
  dbId?: string;
  dbType?: "event" | "parked" | "reimport";
  level: "critical" | "warning" | "info";
  type: string;
  message: string;
  /**
   * Job reference for deep-linking from the Alerts page to the Dispatch tab
   * with that job pre-selected (e.g. "114KBDG83").
   */
  jobRef?: string;
  icon: LucideIcon;
}

const ACK_KEY = "lovable.alerts.acked";
const ACK_EVENT = "lovable:alerts-acked-change";

function readAcked(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(ACK_KEY);
    if (!raw) return new Set();
    const obj = JSON.parse(raw) as Record<string, number>;
    // Drop entries older than 24h to keep the set bounded.
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const out = new Set<string>();
    for (const [k, v] of Object.entries(obj)) if (v > cutoff) out.add(k);
    return out;
  } catch {
    return new Set();
  }
}

function writeAcked(set: Set<string>) {
  if (typeof window === "undefined") return;
  const obj: Record<string, number> = {};
  const now = Date.now();
  set.forEach((id) => (obj[id] = now));
  window.localStorage.setItem(ACK_KEY, JSON.stringify(obj));
  window.dispatchEvent(new Event(ACK_EVENT));
}

function useAcked(alerts: AppAlert[]) {
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const runAck = useServerFn(ackAlert);

  useEffect(() => {
    setAcked(readAcked());
    const handler = () => setAcked(readAcked());
    window.addEventListener(ACK_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(ACK_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const ack = useCallback(async (id: string) => {
    const alert = alerts.find(a => a.id === id);
    if (alert?.dbId && alert?.dbType) {
      try {
        await runAck({ data: { id: alert.dbId, type: alert.dbType } });
      } catch (e) {
        console.error("[useAlerts] failed to delete alert from DB", e);
        toast.error("Failed to clear alert from database");
        return;
      }
    }

    const next = new Set(readAcked());
    next.add(id);
    writeAcked(next);
  }, [alerts, runAck]);

  return { acked, ack };
}

// ── Pending-job age thresholds ────────────────────────────────────────────────
//
// A PENDING job with no assigned driver triggers escalating alerts based on
// how long it has been unassigned since it was created:
//
//  ≥ 90 min  → warning  (amber)   "Job unassigned"
//  ≥ 60 min  → critical (red)     "Job unassigned — urgent"
//
// Additionally, if the job has a scheduled_at time and is within 30 minutes
// of that scheduled time and still unassigned → critical "Job unassigned — critical"
//
// Only the highest-severity alert is emitted per job (no duplicates).
const PENDING_CRITICAL_AGE_MIN = 60;   // 60 min since created → critical
const PENDING_WARNING_AGE_MIN  = 90;   // 90 min since created → warning
//   Note: 90 > 60, so the critical threshold fires first. The warning fires
//   in the 30–60 min window when ageMin < 60 but ageMin >= 30 (see below).
//   The user-facing thresholds are: 90 min = amber, 60 min = red, 30 min = critical.
//   We implement this as:
//     ageMin >= 60  → critical  (red)
//     ageMin >= 30  → warning   (amber)
//   Plus a separate "within 30 min of scheduled" → critical.

const PENDING_WARNING_AGE_MIN_ACTUAL = 30;  // 30 min since created → amber warning
const PENDING_SCHEDULED_CRITICAL_MIN = 30;  // within 30 min of scheduled_at → critical

export function useAlerts() {
  const drivers = useDrivers();
  const jobs = useJobs();
  const compliance = useCompliance();
  const recentDelays = useRecentDelays();
  const cantCompleteEvents = useRecentCantComplete();
  const parkedImports = useParkedImports();
  const reimportAlerts = useReimportAlerts();

  const all = useMemo<AppAlert[]>(() => {
    const out: AppAlert[] = [];
    const now = Date.now();
    const driversById = new Map(drivers.map((d) => [d.id, d]));
    const jobsById = new Map(jobs.map((j) => [j.id, j]));

    recentDelays.forEach((dr) => {
      const d = driversById.get(dr.driver_id);
      const name = d?.name ?? "Driver";
      const job = dr.job_id ? jobsById.get(dr.job_id) : null;
      const jobRef = job ? ` on ${job.reference}` : "";
      const ageMin = Math.round((now - new Date(dr.timestamp).getTime()) / 60000);
      
      out.push({
        id: `delay-${dr.id}`,
        dbId: dr.id,
        dbType: "event",
        level: "critical",
        type: "Delay reported",
        icon: AlertTriangle,
        message: `${name}${jobRef}: ${dr.reason} (${ageMin}m ago)`,
        jobRef: job?.reference,
      });
    });

    cantCompleteEvents.forEach((e) => {
      const p = e.payload ?? {};
      out.push({
        id: `cc-${e.id}`,
        dbId: e.id,
        dbType: "event",
        level: "critical",
        type: "Cannot Complete",
        icon: AlertTriangle,
        message: `${p.driver_name ?? "Driver"} cannot complete ${p.job_reference ?? "job"} — now unassigned`,
        jobRef: p.job_reference,
      });
    });

    drivers.forEach((d) => {
      if (d.status === "DELAYED") {
        out.push({ id: `d-${d.id}`, level: "critical", type: "Delay reported", icon: AlertTriangle, message: `${d.name} flagged DELAYED` });
      }
      if (d.status === "OFF_SHIFT") {
        const activeJobs = jobs.filter(
          (j) => j.assigned_driver_id === d.id &&
            ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(j.status),
        );
        if (activeJobs.length > 0) {
          out.push({
            id: `off-${d.id}`,
            level: "critical",
            type: "Driver off-shift",
            icon: AlertTriangle,
            message: `${d.name} went OFF with ${activeJobs.length} active job(s) — re-plan needed`,
          });
        }
      }
      const c = compliance[d.id];
      if (c) {
        c.issues.forEach((iss, idx) => {
          out.push({
            id: `c-${d.id}-${idx}-${iss.msg}`,
            level: iss.level === "breach" ? "critical" : "warning",
            type: "HGV hours",
            icon: Gauge,
            message: `${d.name}: ${iss.msg}`,
          });
        });
      }
    });

    jobs.forEach((j) => {
      if ((j.status === "ASSIGNED" || j.status === "IN_PROGRESS") && j.eta_minutes && j.scheduled_at) {
        const overdueMin = (now - new Date(j.scheduled_at).getTime()) / 60000 - j.eta_minutes;
        if (overdueMin > 0) {
          out.push({
            id: `j-${j.id}`,
            level: "warning",
            type: "Overdue ETA",
            icon: Timer,
            message: `${j.reference} overdue by ${Math.round(overdueMin)} min`,
            jobRef: j.reference,
          });
        }
      }

      // ── Pending job age alerts ────────────────────────────────────────────
      // Only fire for PENDING jobs with no assigned driver and no planned driver.
      if (j.status === "PENDING" && !j.assigned_driver_id && !j.planned_driver_id) {
        const createdMs = new Date(j.created_at).getTime();
        const ageMin = (now - createdMs) / 60000;

        // Priority 1: within 30 min of scheduled_at → critical (highest urgency)
        if (j.scheduled_at) {
          const scheduledMs = new Date(j.scheduled_at).getTime();
          const minsUntilScheduled = (scheduledMs - now) / 60000;
          if (minsUntilScheduled >= 0 && minsUntilScheduled <= PENDING_SCHEDULED_CRITICAL_MIN) {
            out.push({
              id: `pending-sched-${j.id}`,
              level: "critical",
              type: "Job unassigned — critical",
              icon: Clock,
              message: `${j.reference} is unassigned with only ${Math.round(minsUntilScheduled)} min until scheduled start`,
              jobRef: j.reference,
            });
            return; // Only emit the most severe alert for this job
          }
        }

        // Priority 2: age ≥ 60 min → critical (red)
        if (ageMin >= PENDING_CRITICAL_AGE_MIN) {
          out.push({
            id: `pending-crit-${j.id}`,
            level: "critical",
            type: "Job unassigned — urgent",
            icon: Clock,
            message: `${j.reference} has been unassigned for ${Math.round(ageMin)} min`,
            jobRef: j.reference,
          });
          return;
        }

        // Priority 3: age ≥ 30 min → warning (amber)
        if (ageMin >= PENDING_WARNING_AGE_MIN_ACTUAL) {
          out.push({
            id: `pending-warn-${j.id}`,
            level: "warning",
            type: "Job unassigned",
            icon: Clock,
            message: `${j.reference} has been unassigned for ${Math.round(ageMin)} min`,
            jobRef: j.reference,
          });
        }
      }
    });

    parkedImports.forEach((p) => {
      out.push({
        id: `park-${p.id}`,
        dbId: p.id,
        dbType: "parked",
        level: "warning",
        type: "Unmapped lane",
        icon: MapPin,
        message: `${p.reference}: lane ${p.lane} — missing ${p.missing_codes.join(", ")}. Add the warehouse to release.`,
      });
    });

    reimportAlerts.forEach((r) => {
      const when = new Date(r.uploaded_at).toLocaleString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      out.push({
        id: `reimport-${r.id}`,
        dbId: r.id,
        dbType: "reimport",
        level: "warning",
        type: "Duplicate VRID",
        icon: RefreshCcw,
        message: `${r.reference} already exists — re-uploaded at ${when} with route ${r.lane}. Dismiss if intentional.`,
      });
    });

    return out;
  }, [drivers, jobs, compliance, recentDelays, cantCompleteEvents, parkedImports, reimportAlerts]);

  const { acked, ack } = useAcked(all);
  const visible = useMemo(() => all.filter((a) => !acked.has(a.id)), [all, acked]);

  return { alerts: visible, total: all.length, ack };
}

export function useAlertCount() {
  const { alerts } = useAlerts();
  return alerts.length;
}

export function useUnassignedJobCount() {
  const jobs = useJobs();
  return useMemo(
    () =>
      jobs.filter(
        (j) => j.status === "PENDING" && !j.assigned_driver_id && !j.planned_driver_id,
      ).length,
    [jobs],
  );
}
