import type { JobStatus } from "@/lib/types";

export const JOB_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
  "ARRIVED_PICKUP",
  "EN_ROUTE_DELIVERY",
  "COMPLETED",
  "CANCELLED",
] as const satisfies readonly JobStatus[];

export const ACTIVE_JOB_STATUSES = new Set<JobStatus>([
  "ASSIGNED",
  "IN_PROGRESS",
  "ARRIVED_PICKUP",
  "EN_ROUTE_DELIVERY",
]);

export type EffectiveStatus = JobStatus | "SCHEDULED";

export const STATUS_CONFIG: Record<
  EffectiveStatus,
  {
    label: string;
    dot: string;
    badge: string;
    color: string;
  }
> = {
  PENDING: {
    label: "Pending",
    dot: "bg-amber-400",
    badge: "text-amber-500 bg-amber-500/10",
    color: "var(--warning)",
  },
  ASSIGNED: {
    label: "Scheduled",
    dot: "bg-sky-400",
    badge: "text-sky-500 bg-sky-500/10",
    color: "var(--info)",
  },
  IN_PROGRESS: {
    label: "In Progress",
    dot: "bg-violet-400",
    badge: "text-violet-500 bg-violet-500/10",
    color: "var(--primary)",
  },
  ARRIVED_PICKUP: {
    label: "Arrived Pickup",
    dot: "bg-violet-400",
    badge: "text-violet-500 bg-violet-500/10",
    color: "var(--primary)",
  },
  EN_ROUTE_DELIVERY: {
    label: "En Route Delivery",
    dot: "bg-violet-400",
    badge: "text-violet-500 bg-violet-500/10",
    color: "var(--primary)",
  },
  COMPLETED: {
    label: "Completed",
    dot: "bg-emerald-400",
    badge: "text-emerald-600 bg-emerald-500/10",
    color: "var(--success)",
  },
  CANCELLED: {
    label: "Cancelled",
    dot: "bg-red-400",
    badge: "text-red-500 bg-red-500/10",
    color: "var(--destructive)",
  },
  SCHEDULED: {
    label: "Scheduled",
    dot: "bg-sky-400",
    badge: "text-sky-500 bg-sky-500/10",
    color: "var(--info)",
  },
};

export const STATUS_BOX_KEYS: JobStatus[] = [
  "PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

// ── Date helpers (stateless) ────────────────────────────────────────────────

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
export function fmtDateShort(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export function jobDate(
  j: { scheduled_at: string | null; planned_start_at?: string | null; created_at: string },
  stops: { scheduled_at: string | null }[],
): Date {
  const firstStop = stops.find((s) => s.scheduled_at)?.scheduled_at;
  const iso = j.scheduled_at ?? j.planned_start_at ?? firstStop ?? j.created_at;
  return new Date(iso);
}
