import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Gauge, Timer, type LucideIcon } from "lucide-react";
import { useCompliance, useDrivers, useJobs, useRecentDelays } from "@/lib/hooks";

export interface AppAlert {
  id: string;
  level: "critical" | "warning" | "info";
  type: string;
  message: string;
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

function useAcked() {
  // FIX: initialise with empty set to avoid SSR/client hydration mismatch.
  // localStorage is read inside useEffect (client-only) instead of in the
  // useState initialiser, which runs on the server with no window access.
  const [acked, setAcked] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Populate from storage once mounted on the client.
    setAcked(readAcked());

    const handler = () => setAcked(readAcked());
    window.addEventListener(ACK_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(ACK_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const ack = useCallback((id: string) => {
    const next = new Set(readAcked());
    next.add(id);
    writeAcked(next);
  }, []);

  return { acked, ack };
}

export function useAlerts() {
  const drivers = useDrivers();
  const jobs = useJobs();
  const compliance = useCompliance();
  const recentDelays = useRecentDelays();
  const { acked, ack } = useAcked();

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
        id: `delay-${dr.driver_id}-${dr.timestamp}`,
        level: "critical",
        type: "Delay reported",
        icon: AlertTriangle,
        message: `${name}${jobRef}: ${dr.reason} (${ageMin}m ago)`,
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
          out.push({ id: `j-${j.id}`, level: "warning", type: "Overdue ETA", icon: Timer, message: `${j.reference} overdue by ${Math.round(overdueMin)} min` });
        }
      }
    });

    return out;
  }, [drivers, jobs, compliance, recentDelays]);

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
