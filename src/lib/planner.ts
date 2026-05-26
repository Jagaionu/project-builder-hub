// Two-pass auto-planner for jobs.
//
// Pass 1 — Immediate: drivers currently free (no active job) within 30 km of
//   the first PICKUP are hard-assigned to PENDING jobs. Picks closest.
// Pass 2 — Planned chaining: for the rest, project each driver's end
//   location/time after their current run + already-chained jobs, then look
//   for the closest reachable next pickup that still fits HGV daily/weekly.
// Pass 3 — Leftovers: jobs no driver can take are returned as `unassignable`.

import type { Driver, Warehouse, Job } from "./types";
import type { Compliance } from "./compliance";
import { haversineKm, transitTimeHours, stopDwellMinutes, projectPosition, ARRIVAL_BUFFER_MINUTES } from "./geo";

function tomorrowISODate(nowMs: number): string {
  const t = new Date(nowMs);
  t.setDate(t.getDate() + 1);
  return t.toISOString().slice(0, 10);
}

export const AUTO_ASSIGN_RADIUS_KM = 30;
const DAILY_CAP = 10;
const WEEKLY_CAP = 56;
const ACTIVE = new Set(["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);

export type PlannerStop = {
  kind: "PICKUP" | "DROP";
  warehouse_id: string;
  arrived_at?: string | null;
};
export type StopsMap = Record<string, PlannerStop[]>;

export type ImmediateAssign = { jobId: string; driverId: string; distKm: number };
export type PlannedAssign = {
  jobId: string;
  driverId: string;
  sequence: number;
  startAt: string;
  distKm: number;
  dailyHoursLeft: number;
  weeklyHoursLeft: number;
};
export type Unassignable = { jobId: string; reason: string };

export type PlanResult = {
  immediate: ImmediateAssign[];
  planned: PlannedAssign[];
  unassignable: Unassignable[];
};

// Total hours a job consumes once the driver is at the first stop:
// dwell at every stop (load/unload + checks) + transit (with buffer) between stops.
export function jobDriveHours(stops: PlannerStop[], warehouses: Warehouse[]): number {
  if (stops.length === 0) return 0;
  let minutes = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = warehouses.find((w) => w.id === stops[i].warehouse_id);
    const b = warehouses.find((w) => w.id === stops[i + 1].warehouse_id);
    minutes += stopDwellMinutes(stops[i].kind);
    if (!a || !b) continue;
    minutes += Math.round(transitTimeHours(haversineKm(a.latitude, a.longitude, b.latitude, b.longitude)) * 60) + ARRIVAL_BUFFER_MINUTES;
  }
  minutes += stopDwellMinutes(stops[stops.length - 1].kind);
  return minutes / 60;
}

function firstPickupWh(stops: PlannerStop[] | undefined, warehouses: Warehouse[]) {
  if (!stops?.length) return null;
  const fp = stops.find((s) => s.kind === "PICKUP") ?? stops[0];
  return warehouses.find((w) => w.id === fp.warehouse_id) ?? null;
}
function lastDropWh(stops: PlannerStop[] | undefined, warehouses: Warehouse[]) {
  if (!stops?.length) return null;
  const ld = [...stops].reverse().find((s) => s.kind === "DROP") ?? stops[stops.length - 1];
  return warehouses.find((w) => w.id === ld.warehouse_id) ?? null;
}

type Forecast = { lat: number; lon: number; endMs: number; daily: number; weekly: number };

function remainingJobHours(
  driver: Driver,
  job: Job | null,
  stops: PlannerStop[] | undefined,
  warehouses: Warehouse[],
  nowMs: number,
) {
  if (driver.current_lat == null || driver.current_lon == null) return 0;
  const remaining = (stops ?? []).filter((s) => !s.arrived_at);
  if (remaining.length === 0) return 0;

  // If the job has a scheduled start, use projectPosition to estimate where
  // the driver actually is along the route — gives a much better remaining
  // estimate than raw GPS (which can be mid-leg or stale).
  const startMs = job?.scheduled_at ? +new Date(job.scheduled_at) : null;
  if (startMs && !Number.isNaN(startMs)) {
    const projected = projectPosition(remaining, warehouses, startMs, nowMs);
    if (projected) {
      if (projected.phase === "EN_ROUTE") {
        return (
          projected.minutesUntilNextEvent / 60 +
          jobDriveHours(remaining.slice(projected.stopIndex), warehouses)
        );
      }
      if (projected.phase === "AT_STOP") {
        return (
          projected.minutesUntilNextEvent / 60 +
          jobDriveHours(remaining.slice(projected.stopIndex + 1), warehouses)
        );
      }
      if (projected.phase === "COMPLETED") return 0;
    }
  }

  // Fallback: deadhead from raw GPS to the next unvisited stop + remaining drive.
  const nextWh = warehouses.find((w) => w.id === remaining[0].warehouse_id);
  const deadheadKm = nextWh
    ? haversineKm(driver.current_lat, driver.current_lon, nextWh.latitude, nextWh.longitude)
    : 0;
  return transitTimeHours(deadheadKm) + jobDriveHours(remaining, warehouses);
}

export function computePlan(
  jobs: Job[],
  stopsMap: StopsMap,
  drivers: Driver[],
  warehouses: Warehouse[],
  compliance: Record<string, Compliance>,
  nowMs: number = Date.now(),
): PlanResult {
  const out: PlanResult = { immediate: [], planned: [], unassignable: [] };

  const eligible = drivers.filter(
    (d) =>
      (d.status === "AVAILABLE" || d.status === "ON_SHIFT" || d.status === "ON_ROUTE") &&
      d.current_lat != null &&
      d.current_lon != null,
  );

  // Drivers currently on an active job
  const activeByDriver: Record<string, Job> = {};
  for (const j of jobs) {
    if (j.assigned_driver_id && ACTIVE.has(j.status)) activeByDriver[j.assigned_driver_id] = j;
  }

  // Initial forecast — where/when each driver is expected to be free
  const forecast: Record<string, Forecast> = {};
  for (const d of eligible) {
    const c = compliance[d.id];
    const daily = c?.daily ?? 0;
    const weekly = c?.weekly ?? 0;
    const active = activeByDriver[d.id];
    if (active) {
      const stops = stopsMap[active.id];
      const remaining = (stops ?? []).filter((s) => !s.arrived_at);
      const ld = lastDropWh(remaining, warehouses);
      const drive = remainingJobHours(d, active, stops, warehouses, nowMs);
      forecast[d.id] = {
        lat: ld?.latitude ?? d.current_lat!,
        lon: ld?.longitude ?? d.current_lon!,
        endMs: nowMs + drive * 3_600_000,
        daily: daily + drive,
        weekly: weekly + drive,
      };
    } else {
      forecast[d.id] = {
        lat: d.current_lat!,
        lon: d.current_lon!,
        endMs: nowMs,
        daily,
        weekly,
      };
    }
  }

  const pending = jobs
    .filter((j) => j.status === "PENDING" && !j.assigned_driver_id)
    .sort((a, b) => {
      const ta = a.scheduled_at ? +new Date(a.scheduled_at) : +new Date(a.created_at);
      const tb = b.scheduled_at ? +new Date(b.scheduled_at) : +new Date(b.created_at);
      return ta - tb;
    });

  const claimed = new Set<string>();
  const seqByDriver: Record<string, number> = {};

  const tomorrow = tomorrowISODate(nowMs);

  // --- Pass 1: immediate (free drivers within radius of pickup) ---
  for (const job of pending) {
    const stops = stopsMap[job.id];
    const fp = firstPickupWh(stops, warehouses);
    if (!fp || !stops) continue;

    const isTomorrowJob = (job.for_date ?? null) === tomorrow;

    let best: { d: Driver; dist: number; driveAdd: number } | null = null;
    for (const d of eligible) {
      if (activeByDriver[d.id]) continue;
      if (compliance[d.id]?.blockAssignment) continue;
      // Drivers who opted out of tomorrow must not be auto-planned onto
      // tomorrow-dated jobs (dispatcher can still manually assign them).
      if (isTomorrowJob && (d as Driver & { available_tomorrow?: boolean }).available_tomorrow === false) continue;
      const dist = haversineKm(d.current_lat!, d.current_lon!, fp.latitude, fp.longitude);
      if (dist > AUTO_ASSIGN_RADIUS_KM) continue;
      const driveAdd = jobDriveHours(stops, warehouses) + transitTimeHours(dist);
      const f = forecast[d.id];
      if (f.daily + driveAdd > DAILY_CAP) continue;
      if (f.weekly + driveAdd > WEEKLY_CAP) continue;
      if (!best || dist < best.dist) best = { d, dist, driveAdd };
    }
    if (best) {
      out.immediate.push({ jobId: job.id, driverId: best.d.id, distKm: best.dist });
      claimed.add(job.id);
      activeByDriver[best.d.id] = job;
      const ld = lastDropWh(stops, warehouses);
      const f = forecast[best.d.id];
      f.lat = ld?.latitude ?? f.lat;
      f.lon = ld?.longitude ?? f.lon;
      f.endMs += best.driveAdd * 3_600_000;
      f.daily += best.driveAdd;
      f.weekly += best.driveAdd;
    }
  }

  // --- Pass 2: planned chaining onto driver forecasts ---
  for (const job of pending) {
    if (claimed.has(job.id)) continue;
    const stops = stopsMap[job.id];
    const fp = firstPickupWh(stops, warehouses);
    if (!fp || !stops) continue;

    let best: { d: Driver; dist: number; driveAdd: number; transit: number } | null = null;
    let nearMiss: { name: string; dist: number; reason: string } | null = null;

    for (const d of eligible) {
      const f = forecast[d.id];
      const dist = haversineKm(f.lat, f.lon, fp.latitude, fp.longitude);
      const transit = transitTimeHours(dist);
      const driveAdd = jobDriveHours(stops, warehouses) + transit;
      const overRadius = dist > AUTO_ASSIGN_RADIUS_KM;
      const overDaily = f.daily + driveAdd > DAILY_CAP;
      const overWeekly = f.weekly + driveAdd > WEEKLY_CAP;
      if (overRadius || overDaily || overWeekly) {
        const reason = overRadius
          ? `${dist.toFixed(1)} km from end of last run`
          : overDaily
            ? `would exceed daily ${(f.daily + driveAdd).toFixed(1)}/10h`
            : `would exceed weekly ${(f.weekly + driveAdd).toFixed(1)}/56h`;
        if (!nearMiss || dist < nearMiss.dist) nearMiss = { name: d.name, dist, reason };
        continue;
      }
      if (!best || dist < best.dist) best = { d, dist, driveAdd, transit };
    }

    if (best) {
      const f = forecast[best.d.id];
      const startMs = f.endMs + best.transit * 3_600_000;
      const seq = (seqByDriver[best.d.id] = (seqByDriver[best.d.id] ?? 0) + 1);
      const nextDaily = f.daily + best.driveAdd;
      const nextWeekly = f.weekly + best.driveAdd;
      out.planned.push({
        jobId: job.id,
        driverId: best.d.id,
        sequence: seq,
        startAt: new Date(startMs).toISOString(),
        distKm: best.dist,
        dailyHoursLeft: Math.max(0, DAILY_CAP - nextDaily),
        weeklyHoursLeft: Math.max(0, WEEKLY_CAP - nextWeekly),
      });
      const ld = lastDropWh(stops, warehouses);
      f.lat = ld?.latitude ?? f.lat;
      f.lon = ld?.longitude ?? f.lon;
      f.endMs += best.driveAdd * 3_600_000;
      f.daily += best.driveAdd;
      f.weekly += best.driveAdd;
    } else {
      const reason = nearMiss
        ? `Closest: ${nearMiss.name} — ${nearMiss.reason}`
        : "No eligible driver on shift";
      out.unassignable.push({ jobId: job.id, reason });
    }
  }

  return out;
}

// ----- Tomorrow planner -----
// Plans jobs that are scheduled for tomorrow against drivers who opted in via
// Telegram (`available_tomorrow = true` + start lat/lon). Each driver gets a
// daily budget (9h base, capped by weekly/fortnight headroom) and is chained
// — the next job starts from where the last one dropped.

export function computeTomorrowPlan(
  tomorrowJobs: Job[],
  stopsMap: StopsMap,
  drivers: Driver[],
  warehouses: Warehouse[],
  compliance: Record<string, Compliance>,
): PlanResult {
  const out: PlanResult = { immediate: [], planned: [], unassignable: [] };

  type TForecast = { lat: number; lon: number; hoursLeft: number; sequence: number };
  const forecast: Record<string, TForecast> = {};
  const driverById: Record<string, Driver> = {};

  for (const d of drivers) {
    const dd = d as Driver & {
      available_tomorrow?: boolean;
      tomorrow_start_lat?: number | null;
      tomorrow_start_lon?: number | null;
    };
    if (!dd.available_tomorrow) continue;
    // Prefer the driver-reported tomorrow start location; fall back to their
    // last known GPS so an opt-in without a pinned start point still plans.
    const startLat = dd.tomorrow_start_lat ?? d.current_lat ?? null;
    const startLon = dd.tomorrow_start_lon ?? d.current_lon ?? null;
    if (startLat == null || startLon == null) continue;
    const c = compliance[d.id];
    if (c?.blockAssignment) continue;
    let cap = 9;
    if (c) {
      if (c.weekly >= 47) cap = Math.min(cap, 56 - c.weekly);
      if (c.twoWeek >= 81) cap = Math.min(cap, 90 - c.twoWeek);
    }
    if (cap <= 0) continue;
    forecast[d.id] = {
      lat: startLat,
      lon: startLon,
      hoursLeft: cap,
      sequence: 0,
    };
    driverById[d.id] = d;
  }

  const eligibleIds = Object.keys(forecast);

  // Nominal tomorrow 06:00 UTC start
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + 1);
  t.setUTCHours(6, 0, 0, 0);
  const baseStartMs = t.getTime();
  const driverElapsed: Record<string, number> = {};

  // Longest-first
  const sorted = [...tomorrowJobs].sort((a, b) => {
    const ha = jobDriveHours(stopsMap[a.id] ?? [], warehouses);
    const hb = jobDriveHours(stopsMap[b.id] ?? [], warehouses);
    return hb - ha;
  });

  for (const job of sorted) {
    const stops = stopsMap[job.id] ?? [];
    const fp = firstPickupWh(stops, warehouses);
    if (!fp || stops.length === 0) {
      out.unassignable.push({ jobId: job.id, reason: "No stops / pickup configured" });
      continue;
    }
    const jobH = jobDriveHours(stops, warehouses);

    let best: { id: string; dist: number; total: number; transit: number } | null = null;
    let nearMiss: { name: string; dist: number; reason: string } | null = null;

    for (const did of eligibleIds) {
      const f = forecast[did];
      const dist = haversineKm(f.lat, f.lon, fp.latitude, fp.longitude);
      const transit = transitTimeHours(dist);
      const total = transit + jobH;
      if (f.hoursLeft < total) {
        const reason = `needs ${total.toFixed(1)}h, ${f.hoursLeft.toFixed(1)}h left`;
        if (!nearMiss || dist < nearMiss.dist) nearMiss = { name: driverById[did].name, dist, reason };
        continue;
      }
      if (!best || dist < best.dist) best = { id: did, dist, total, transit };
    }

    if (!best) {
      const reason = nearMiss
        ? `Closest: ${nearMiss.name} — ${nearMiss.reason}`
        : eligibleIds.length === 0
          ? "No drivers available for tomorrow"
          : "No eligible driver";
      out.unassignable.push({ jobId: job.id, reason });
      continue;
    }

    const f = forecast[best.id];
    const seq = ++f.sequence;
    const elapsedH = driverElapsed[best.id] ?? 0;
    const startMs = baseStartMs + elapsedH * 3_600_000;
    driverElapsed[best.id] = elapsedH + best.total;

    const c = compliance[best.id];
    const weeklyBase = c?.weekly ?? 0;

    out.planned.push({
      jobId: job.id,
      driverId: best.id,
      sequence: seq,
      startAt: new Date(startMs).toISOString(),
      distKm: best.dist,
      dailyHoursLeft: Math.max(0, f.hoursLeft - best.total),
      weeklyHoursLeft: Math.max(0, 56 - weeklyBase - best.total),
    });

    const ld = lastDropWh(stops, warehouses);
    f.lat = ld?.latitude ?? f.lat;
    f.lon = ld?.longitude ?? f.lon;
    f.hoursLeft -= best.total;
  }

  return out;
}
