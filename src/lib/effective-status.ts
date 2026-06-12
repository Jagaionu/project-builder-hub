// Display-only status helpers.
//
// Underlying job.status / driver.status in the DB are unchanged — these
// helpers just decide what the dispatcher should SEE for jobs that are
// technically "accepted" but whose first pickup is still in the future.
// A driver cannot be physically ON_ROUTE at 08:30 if the first pickup
// is scheduled for 11:00.
//
// `effectiveJobStatus()` returns "SCHEDULED" instead of IN_PROGRESS /
// ASSIGNED while the first pickup is in the future and the driver has
// not arrived at any stop yet.

import { haversineKm, transitTimeHours, ARRIVAL_BUFFER_MINUTES } from "@/lib/geo";

type StopLite = {
  seq: number;
  kind: "PICKUP" | "DROP";
  warehouse_id: string;
  scheduled_at: string | null;
  arrived_at: string | null;
  warehouse?: { id: string; latitude: number; longitude: number; code?: string } | null;
};

type JobLite = {
  id: string;
  status: string;
  assigned_driver_id: string | null;
  planned_driver_id?: string | null;
  planned_start_at?: string | null;
  scheduled_at: string | null;
  for_date?: string | null;
  stops?: StopLite[];
};

const ACTIVE_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);

export function jobStartMs(job: JobLite): number | null {
  const sorted = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);
  const first = sorted[0];
  const iso = first?.scheduled_at ?? job.planned_start_at ?? job.scheduled_at ?? null;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

// True when the job is accepted/in-progress but no stop has actually been
// reached yet AND the first pickup is still in the future.
export function isJobScheduledFuture(job: JobLite, nowMs: number): boolean {
  if (!ACTIVE_STATUSES.has(job.status)) return false;
  const stops = job.stops ?? [];
  if (stops.some((s) => s.arrived_at)) return false;
  const start = jobStartMs(job);
  if (start == null) return false;
  return start > nowMs;
}

export function effectiveJobStatus(job: JobLite, nowMs: number = Date.now()): string {
  return isJobScheduledFuture(job, nowMs) ? "SCHEDULED" : job.status;
}

export type ScheduleStatus = "scheduled" | "not_scheduled" | "holiday" | "unknown";

// A driver is only "ON_ROUTE" when at least one of their active jobs has
// actually started (first pickup time has passed or a stop was reached).
// Otherwise display as ON_SHIFT / AVAILABLE depending on raw status.
//
// When `schedule` is provided and the driver is idle (raw OFF_SHIFT or
// AVAILABLE), today's calendar projects onto the badge:
//   not_scheduled → "OFF_SHIFT"
//   scheduled     → "AVAILABLE"
//   unknown       → pass through raw (loading state)
// Other raw statuses (ARRIVED_PICKUP, EN_ROUTE_DELIVERY, DELAYED, etc.)
// are passed through untouched regardless of schedule.
export function effectiveDriverStatus(
  rawStatus: string,
  driverJobs: JobLite[],
  nowMs: number = Date.now(),
  schedule: ScheduleStatus = "unknown",
): string {
  if (schedule === "holiday") {
    const onActiveRoute = driverJobs.some((j) =>
      ACTIVE_STATUSES.has(j.status) ? !isJobScheduledFuture(j, nowMs) : false,
    );
    if (!onActiveRoute) return "OFF_SHIFT";
  }

  if (rawStatus === "ON_ROUTE") {
    const anyStarted = driverJobs.some(
      (j) => ACTIVE_STATUSES.has(j.status) && !isJobScheduledFuture(j, nowMs),
    );
    return anyStarted ? "ON_ROUTE" : "ON_SHIFT";
  }

  // Calendar-driven, collapsed into On Route / On Shift / Off Shift (no "Available").
  if (rawStatus === "OFF_SHIFT" || rawStatus === "AVAILABLE") {
    if (schedule === "scheduled") return "ON_SHIFT";
    if (schedule === "not_scheduled") return "OFF_SHIFT";
    return rawStatus === "AVAILABLE" ? "ON_SHIFT" : "OFF_SHIFT";
  }

  return rawStatus;
}

// Projected driving minutes for the planner: deadhead from the driver's
// current GPS to the first pickup, plus pure transit between subsequent
// stops. Excludes dwell / loading / unloading.
export function projectedRouteDriveMinutes(
  job: JobLite,
  driverLat: number | null,
  driverLon: number | null,
): { deadheadMin: number; transitMin: number; totalMin: number } {
  const stops = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);
  let deadheadMin = 0;
  let transitMin = 0;
  const firstWh = stops[0]?.warehouse;
  if (firstWh && driverLat != null && driverLon != null) {
    const km = haversineKm(driverLat, driverLon, firstWh.latitude, firstWh.longitude);
    deadheadMin = Math.round(transitTimeHours(km) * 60) + ARRIVAL_BUFFER_MINUTES;
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].warehouse;
    const b = stops[i + 1].warehouse;
    if (!a || !b) continue;
    const km = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    transitMin += Math.round(transitTimeHours(km) * 60) + ARRIVAL_BUFFER_MINUTES;
  }
  return { deadheadMin, transitMin, totalMin: deadheadMin + transitMin };
}
