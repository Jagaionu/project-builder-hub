import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Gauge,
  Timer,
  MapPin,
  RefreshCcw,
  Clock,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useCompliance, useDrivers, useJobs, useRecentDelays, useWarehouses } from "@/lib/hooks";
import { useDriverSchedule } from "@/lib/use-driver-schedule";
import { useJobStops } from "@/lib/dispatch/use-job-stops";
import { effectiveDriverStatus } from "@/lib/effective-status";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { ackAlert } from "./alerts.functions";
import { toast } from "sonner";
import { useTenant } from "@/lib/tenant-context";

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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "driver_events" },
        debounced,
      )
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pending_job_imports" },
        debounced,
      )
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

// ── Lane transit-time trend alerts ───────────────────────────────────────────
// Surfaces lanes whose recent (21-day) median has risen materially vs the 90-day
// baseline — the early-warning for road works / a newly busier lane. Computed by
// the hourly aggregation cron (trend_state/trend_pct on lane_travel_times); we
// just read the "rising" rows here. Auto-clears when a lane normalises.
type LaneTrendRow = {
  from_warehouse_id: string | null;
  to_warehouse_id: string | null;
  p50_duration_minutes: number | null;
  recent_p50_duration_minutes: number | null;
  trend_pct: number | null;
  trend_state: string | null;
};

function useLaneTrends(): LaneTrendRow[] {
  const [rows, setRows] = useState<LaneTrendRow[]>([]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("lane_travel_times" as never)
        .select(
          "from_warehouse_id,to_warehouse_id,p50_duration_minutes,recent_p50_duration_minutes,trend_pct,trend_state",
        )
        .eq("trend_state", "rising" as never)
        .order("trend_pct", { ascending: false });
      if (!mounted || !data) return;
      setRows(data as unknown as LaneTrendRow[]);
    };
    void load();
    // The aggregation cron only updates hourly, so a light refresh is plenty.
    const t = setInterval(() => void load(), 15 * 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);
  return rows;
}

// Format a minutes value as "2h00" / "1h35" / "45m".
function fmtMin(m: number | null): string {
  if (m == null) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h${mm.toString().padStart(2, "0")}`;
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

  const ack = useCallback(
    async (id: string) => {
      const alert = alerts.find((a) => a.id === id);
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
    },
    [alerts, runAck],
  );

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
// ── Pending-job pickup thresholds ──────────────────────────────────────────
//
// A PENDING job with no assigned driver triggers alerts based on its scheduled
// pickup time:
//
//  ≤ 90 min until pickup → warning  (amber)
//  ≤ 60 min until pickup → critical (red)
//
// Only the highest-severity alert is emitted per job.
const PENDING_PICKUP_WARNING_MIN = 90;
const PENDING_PICKUP_CRITICAL_MIN = 60;

type BillingExpiry = {
  subscription_status: string | null;
  subscription_ends_at: string | null;
  current_period_end: string | null;
};

// Caller company billing dates (RLS scopes to own company) for the admin
// pre-expiry warning.
function useBillingExpiry(companyId: string | undefined): BillingExpiry | null {
  const [row, setRow] = useState<BillingExpiry | null>(null);
  useEffect(() => {
    if (!companyId) return;
    let mounted = true;
    void (async () => {
      const { data } = await supabase
        .from("companies")
        .select("subscription_status, subscription_ends_at, current_period_end")
        .eq("id", companyId)
        .maybeSingle();
      if (mounted) setRow((data as BillingExpiry | null) ?? null);
    })();
    return () => {
      mounted = false;
    };
  }, [companyId]);
  return row;
}

export function useAlerts() {
  const drivers = useDrivers();
  const jobs = useJobs();
  const compliance = useCompliance();
  const recentDelays = useRecentDelays();
  const cantCompleteEvents = useRecentCantComplete();
  const parkedImports = useParkedImports();
  const reimportAlerts = useReimportAlerts();
  const warehouses = useWarehouses();
  const laneTrends = useLaneTrends();
  const jobStops = useJobStops();
  const { role, isSuperAdmin, company } = useTenant();
  const billing = useBillingExpiry(company?.id);

  const driverIds = useMemo(() => drivers.map((d) => d.id), [drivers]);
  const schedule = useDriverSchedule(driverIds);

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
        out.push({
          id: `d-${d.id}`,
          level: "critical",
          type: "Delay reported",
          icon: AlertTriangle,
          message: `${d.name} flagged DELAYED`,
        });
      }
      // Calendar-accurate off-shift alert: only fire when TODAY's schedule
      // confirms the driver is off (not scheduled, or on holiday) — never from a
      // stale stored status alone. A driver scheduled on the calendar today
      // (like one whose raw status is still OFF_SHIFT) will NOT trigger this.
      const sched = schedule[d.id] ?? "unknown";
      if (sched === "not_scheduled" || sched === "holiday") {
        const driverJobs = jobs.filter((j) => j.assigned_driver_id === d.id);
        const eff = effectiveDriverStatus(d.status, driverJobs, now, sched);
        if (eff === "OFF_SHIFT") {
          const activeJobs = driverJobs.filter((j) =>
            ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(j.status),
          );
          if (activeJobs.length > 0) {
            out.push({
              id: `off-${d.id}`,
              level: "critical",
              type: "Driver off-shift",
              icon: AlertTriangle,
              message: `${d.name} is off today (${sched === "holiday" ? "holiday" : "not scheduled"}) with ${activeJobs.length} active job(s) — re-plan needed`,
            });
          }
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
      if (
        (j.status === "ASSIGNED" || j.status === "IN_PROGRESS") &&
        j.eta_minutes &&
        j.scheduled_at
      ) {
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

      // ── Pending job pickup alerts ─────────────────────────────────────────
      // Only fire for PENDING jobs with no assigned driver and no planned driver.
      if (j.status === "PENDING" && !j.assigned_driver_id && !j.planned_driver_id) {
        if (j.scheduled_at) {
          const scheduledMs = new Date(j.scheduled_at).getTime();
          const minsUntilScheduled = (scheduledMs - now) / 60000;

          // Priority 1: ≤ 60 min until pickup → critical (red)
          if (minsUntilScheduled >= 0 && minsUntilScheduled <= PENDING_PICKUP_CRITICAL_MIN) {
            out.push({
              id: `pending-crit-${j.id}`,
              level: "critical",
              type: "Job unassigned — critical",
              icon: Clock,
              message: `${j.reference} is unassigned with only ${Math.round(minsUntilScheduled)} min until scheduled start`,
              jobRef: j.reference,
            });
            return;
          }

          // Priority 2: ≤ 90 min until pickup → warning (amber)
          if (minsUntilScheduled >= 0 && minsUntilScheduled <= PENDING_PICKUP_WARNING_MIN) {
            out.push({
              id: `pending-warn-${j.id}`,
              level: "warning",
              type: "Job unassigned",
              icon: Clock,
              message: `${j.reference} is unassigned with only ${Math.round(minsUntilScheduled)} min until scheduled start`,
              jobRef: j.reference,
            });
          }
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
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
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

    // Lane transit-time rising alerts — one per lane (worst-trending bucket).
    const whById = new Map(warehouses.map((w) => [w.id, w]));
    const bestByLane = new Map<string, LaneTrendRow>();
    for (const r of laneTrends) {
      if (!r.from_warehouse_id || !r.to_warehouse_id) continue;
      const k = `${r.from_warehouse_id}|${r.to_warehouse_id}`;
      const prev = bestByLane.get(k);
      if (!prev || (r.trend_pct ?? 0) > (prev.trend_pct ?? 0)) bestByLane.set(k, r);
    }
    for (const [k, r] of bestByLane) {
      const fromW = whById.get(r.from_warehouse_id as string);
      const toW = whById.get(r.to_warehouse_id as string);
      if (!fromW && !toW) continue; // skip lanes we can't label at all
      const fromLabel = fromW?.code ?? "?";
      const toLabel = toW?.code ?? "?";
      const pctStr = r.trend_pct != null ? `+${r.trend_pct}%, ` : "";
      out.push({
        id: `lanetrend-${k}`,
        level: "warning",
        type: "Transit time rising",
        icon: TrendingUp,
        message: `${fromLabel}→${toLabel}: typical ${fmtMin(r.p50_duration_minutes)} → ${fmtMin(r.recent_p50_duration_minutes)} (${pctStr}last 21 days). Possible road works — review planning.`,
      });
    }

    // Held-at-collection: driver kept at a pickup longer than the handling
    // window on an active run (explains a late drop).
    jobs.forEach((j) => {
      if (j.status === "COMPLETED" || j.status === "CANCELLED") return;
      const sts = jobStops[j.id];
      if (!sts) return;
      const handling = (j as { handling_minutes?: number | null }).handling_minutes ?? 20;
      for (const st of sts) {
        if (st.kind !== "PICKUP" || !st.arrived_at || !st.departed_at) continue;
        const over =
          Math.round(
            (new Date(st.departed_at).getTime() - new Date(st.arrived_at).getTime()) / 60_000,
          ) - handling;
        if (over > 10) {
          const wh = whById.get(st.warehouse_id);
          const d = j.assigned_driver_id ? driversById.get(j.assigned_driver_id) : null;
          out.push({
            id: "held-" + st.id,
            level: "warning",
            type: "Held at collection",
            icon: Clock,
            message:
              (d?.name ?? "Driver") +
              " held " +
              over +
              " min over at " +
              (wh?.code ?? "collection") +
              " on " +
              j.reference +
              " — drop ETA pushed",
            jobRef: j.reference,
          });
        }
      }
    });

    // Admin-only: upcoming payment / plan-expiry warning. Warns from 3 days
    // out, escalating to critical inside the last 24h. Dispatchers and
    // members never see it (only the company admin).
    if (role === "admin" && !isSuperAdmin && billing) {
      const status = billing.subscription_status;
      const expiryIso =
        status === "trial" ? billing.subscription_ends_at : billing.current_period_end;
      if (expiryIso) {
        const msUntil = new Date(expiryIso).getTime() - now;
        const hoursUntil = msUntil / 3600000;
        const daysUntil = Math.ceil(hoursUntil / 24);
        const dateStr = new Date(expiryIso).toLocaleDateString([], { day: "numeric", month: "short" });
        const noun = status === "trial" ? "Your free trial ends" : "Your plan renews";
        if (msUntil > 0 && hoursUntil <= 24) {
          const hrs = Math.max(1, Math.round(hoursUntil));
          out.push({
            id: "plan-expiry-crit-" + expiryIso,
            level: "critical",
            type: "Payment due",
            icon: AlertTriangle,
            message: noun + " in " + hrs + " hour" + (hrs === 1 ? "" : "s") + " (" + dateStr + "). Complete payment on the Billing page now to avoid losing access.",
          });
        } else if (msUntil > 0 && daysUntil <= 3) {
          out.push({
            id: "plan-expiry-warn-" + expiryIso,
            level: "warning",
            type: "Payment due",
            icon: Clock,
            message: noun + " in " + daysUntil + " day" + (daysUntil === 1 ? "" : "s") + " (" + dateStr + "). Confirm your payment method on the Billing page.",
          });
        }
      }
    }

    return out;
  }, [drivers, jobs, compliance, recentDelays, cantCompleteEvents, parkedImports, reimportAlerts, warehouses, laneTrends, jobStops, schedule, role, isSuperAdmin, billing]);

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
      jobs.filter((j) => j.status === "PENDING" && !j.assigned_driver_id && !j.planned_driver_id)
        .length,
    [jobs],
  );
}
