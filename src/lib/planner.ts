// Two-pass auto-planner for jobs.
//
// Pass 1 — Immediate: drivers currently free (no active job) within 30 km of
//   the first PICKUP are hard-assigned to PENDING jobs. Picks closest.
// Pass 2 — Planned chaining: for the rest, project each driver's end
//   location/time after their current run + already-chained jobs, then look
//   for the closest reachable next pickup that still fits HGV daily/weekly.
// Pass 3 — Leftovers: jobs no driver can take are returned as `unassignable`.

import type { Driver, Warehouse, Job, DriverShift, DriverAvailabilityOverride } from "./types";
import type { Compliance } from "./compliance";
import {
  haversineKm,
  transitTimeHours,
  stopDwellMinutes,
  projectPosition,
  ARRIVAL_BUFFER_MINUTES,
} from "./geo";

export function isDriverAvailableOnDate(
  driverId: string,
  dateStr: string,
  shifts: Record<string, DriverShift>,
  overrides: DriverAvailabilityOverride[],
): boolean {
  // 1. Explicit overrides (holidays, sick days, extra availability) take priority.
  const override = overrides.find((o) => o.driver_id === driverId && o.date === dateStr);
  if (override !== undefined) return override.available;

  // 2. Check the weekly shift schedule.
  const shift = shifts[driverId];
  // No shift record means no schedule configured → assume available (open policy).
  // A planner can always add an override to block a specific day.
  // This prevents a "nobody works" blackout when the driver_shifts table has
  // just been created and rows haven't been seeded yet.
  if (!shift) return true;
  // Shift exists but zero working days = driver never works (e.g. contractor pause).
  if (shift.days_of_week.length === 0) return false;

  const dayOfWeek = new Date(dateStr + "T12:00:00").getDay();
  return shift.days_of_week.includes(dayOfWeek);
}

function tomorrowISODate(nowMs: number): string {
  const t = new Date(nowMs);
  t.setDate(t.getDate() + 1);
  return t.toISOString().slice(0, 10);
}

export const AUTO_ASSIGN_RADIUS_KM = 30;
// Planned chaining uses a wider radius: the driver's projected end-position
// is hours in the future so a strict 30 km cap is overly conservative.
const CHAIN_RADIUS_KM = 80;
const DAILY_CAP = 10;
const WEEKLY_CAP = 56;
const ACTIVE = new Set(["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);

// HGV Break Rules (Simplified for UK/EU)
// - 45 min break after 4.5h of driving.
// - In this planner, we insert a 45 min buffer if the total drive time
//   exceeds 4.5h without a sufficient break.
const BREAK_THRESHOLD_HOURS = 4.5;
const BREAK_DURATION_MINUTES = 45;

export type PlannerStop = {
  kind: "PICKUP" | "DROP";
  warehouse_id: string;
  arrived_at?: string | null;
  scheduled_at?: string | null;
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
    if (!a || !b) continue;
    minutes +=
      Math.round(
        transitTimeHours(haversineKm(a.latitude, a.longitude, b.latitude, b.longitude)) * 60,
      ) + ARRIVAL_BUFFER_MINUTES;
  }
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

type Forecast = {
  lat: number;
  lon: number;
  endMs: number;
  daily: number;
  weekly: number;
  continuous: number;
};

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

/**
 * Calculates whether a break is needed and returns the added delay in MS.
 */
function calculateBreakDelayMs(currentContinuous: number, driveAdd: number): number {
  if (currentContinuous + driveAdd > BREAK_THRESHOLD_HOURS) {
    return BREAK_DURATION_MINUTES * 60_000;
  }
  return 0;
}

export function computePlan(
  jobs: Job[],
  stopsMap: StopsMap,
  drivers: Driver[],
  warehouses: Warehouse[],
  compliance: Record<string, Compliance>,
  nowMs: number = Date.now(),
  shifts: Record<string, DriverShift> = {},
  overrides: DriverAvailabilityOverride[] = [],
): PlanResult {
  const out: PlanResult = { immediate: [], planned: [], unassignable: [] };
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const hasShiftData = Object.keys(shifts).length > 0;

  const eligible = drivers.filter(
    (d) =>
      (d.status === "AVAILABLE" || d.status === "ON_SHIFT" || d.status === "ON_ROUTE") &&
      d.current_lat != null &&
      d.current_lon != null &&
      (!hasShiftData || isDriverAvailableOnDate(d.id, todayStr, shifts, overrides)),
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
    const continuous = c?.continuousDrive ?? 0;
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
        continuous: continuous + drive,
      };
    } else {
      forecast[d.id] = {
        lat: d.current_lat!,
        lon: d.current_lon!,
        endMs: nowMs,
        daily,
        weekly,
        continuous,
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

    let best: { d: Driver; dist: number; driveAdd: number; breakMs: number } | null = null;
    for (const d of eligible) {
      if (activeByDriver[d.id]) continue;
      if (compliance[d.id]?.blockAssignment) continue;
      if (isTomorrowJob) {
        const isAvailableTomorrow = hasShiftData
          ? isDriverAvailableOnDate(d.id, tomorrow, shifts, overrides)
          : (d as Driver & { available_tomorrow?: boolean }).available_tomorrow !== false;
        if (!isAvailableTomorrow) continue;
      }

      const dist = haversineKm(d.current_lat!, d.current_lon!, fp.latitude, fp.longitude);
      if (dist > AUTO_ASSIGN_RADIUS_KM) continue;

      const transit = transitTimeHours(dist);
      const jobH = jobDriveHours(stops, warehouses);
      const driveAdd = jobH + transit;

      const f = forecast[d.id];
      const breakMs = calculateBreakDelayMs(f.continuous, driveAdd);

      if (f.daily + driveAdd > DAILY_CAP) continue;
      if (f.weekly + driveAdd > WEEKLY_CAP) continue;
      if (!best || dist < best.dist) best = { d, dist, driveAdd, breakMs };
    }
    if (best) {
      out.immediate.push({ jobId: job.id, driverId: best.d.id, distKm: best.dist });
      claimed.add(job.id);
      activeByDriver[best.d.id] = job;
      const ld = lastDropWh(stops, warehouses);
      const f = forecast[best.d.id];
      f.lat = ld?.latitude ?? f.lat;
      f.lon = ld?.longitude ?? f.lon;
      f.endMs += best.driveAdd * 3_600_000 + best.breakMs;
      f.daily += best.driveAdd;
      f.weekly += best.driveAdd;
      f.continuous =
        best.breakMs > 0
          ? Math.max(0, best.driveAdd - BREAK_THRESHOLD_HOURS)
          : f.continuous + best.driveAdd;
    }
  }

  // --- Pass 2: planned chaining onto driver forecasts ---
  for (const job of pending) {
    if (claimed.has(job.id)) continue;
    const stops = stopsMap[job.id];
    const fp = firstPickupWh(stops, warehouses);
    if (!fp || !stops) continue;

    const isTomorrowJob = (job.for_date ?? null) === tomorrow;

    let best: {
      d: Driver;
      dist: number;
      driveAdd: number;
      transit: number;
      breakMs: number;
    } | null = null;
    let nearMiss: { name: string; dist: number; reason: string } | null = null;

    for (const d of eligible) {
      if (isTomorrowJob) {
        const isAvailableTomorrow = hasShiftData
          ? isDriverAvailableOnDate(d.id, tomorrow, shifts, overrides)
          : (d as Driver & { available_tomorrow?: boolean }).available_tomorrow !== false;
        if (!isAvailableTomorrow) continue;
      }
      const f = forecast[d.id];
      const dist = haversineKm(f.lat, f.lon, fp.latitude, fp.longitude);
      const transit = transitTimeHours(dist);
      const jobH = jobDriveHours(stops, warehouses);
      const driveAdd = jobH + transit;

      const breakMs = calculateBreakDelayMs(f.continuous, driveAdd);

      const overRadius = dist > CHAIN_RADIUS_KM;
      const overDaily = f.daily + driveAdd > DAILY_CAP;
      const overWeekly = f.weekly + driveAdd > WEEKLY_CAP;

      if (overRadius || overDaily || overWeekly) {
        const reason = overRadius
          ? `${dist.toFixed(1)} km from end of last run (limit ${CHAIN_RADIUS_KM} km)`
          : overDaily
            ? `would exceed daily ${(f.daily + driveAdd).toFixed(1)}/10h`
            : `would exceed weekly ${(f.weekly + driveAdd).toFixed(1)}/56h`;
        if (!nearMiss || dist < nearMiss.dist) nearMiss = { name: d.name, dist, reason };
        continue;
      }
      if (!best || dist < best.dist) best = { d, dist, driveAdd, transit, breakMs };
    }

    if (best) {
      const f = forecast[best.d.id];
      const startMs = f.endMs + best.transit * 3_600_000 + best.breakMs;
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
      f.endMs += best.driveAdd * 3_600_000 + best.breakMs;
      f.daily = nextDaily;
      f.weekly = nextWeekly;
      f.continuous =
        best.breakMs > 0
          ? Math.max(0, best.driveAdd - BREAK_THRESHOLD_HOURS)
          : f.continuous + best.driveAdd;
    } else {
      const reason = nearMiss
        ? `Closest: ${nearMiss.name} — ${nearMiss.reason}`
        : "No eligible driver on shift";
      out.unassignable.push({ jobId: job.id, reason });
    }
  }

  return out;
}

// ----- Date-aware planner (any date) -----

/**
 * Plans all jobs for a specific date.
 *
 * targetDate — YYYY-MM-DD string of the day being planned.
 * jobs       — jobs already filtered to this date (for_date === targetDate).
 * shifts     — driver_shifts keyed by driver_id.
 * overrides  — ALL driver_availability_overrides (any date); filtered internally by targetDate.
 * nowMs      — current wall-clock time; used to set a sensible start floor for today's jobs.
 *
 * A driver with NO shift record is treated as available (open schedule).
 * A driver with an explicit override for targetDate takes that value.
 * A driver with days_of_week = [] is never available.
 */
export function computePlanForDate(
  targetDate: string,
  jobs: Job[],
  stopsMap: StopsMap,
  drivers: Driver[],
  warehouses: Warehouse[],
  compliance: Record<string, Compliance>,
  shifts: Record<string, DriverShift> = {},
  overrides: DriverAvailabilityOverride[] = [],
  nowMs: number = Date.now(),
): PlanResult {
  const out: PlanResult = { immediate: [], planned: [], unassignable: [] };

  type TForecast = {
    lat: number;
    lon: number;
    hoursLeft: number;
    sequence: number;
    continuous: number;
  };
  const forecast: Record<string, TForecast> = {};
  const driverById: Record<string, Driver> = {};

  for (const d of drivers) {
    const dd = d as Driver & {
      tomorrow_start_lat?: number | null;
      tomorrow_start_lon?: number | null;
    };
    // Always use the calendar-based availability — no legacy available_tomorrow fallback.
    if (!isDriverAvailableOnDate(d.id, targetDate, shifts, overrides)) continue;

    // For the target date use the driver's declared start position if available,
    // otherwise fall back to their last known GPS. Drivers without any position
    // are excluded since we cannot estimate transit times.
    const startLat = dd.tomorrow_start_lat ?? d.current_lat ?? null;
    const startLon = dd.tomorrow_start_lon ?? d.current_lon ?? null;
    if (startLat == null || startLon == null) continue;

    const c = compliance[d.id];
    if (c?.blockAssignment) continue;

    // Daily cap: 9h is the typical HGV limit. Reduce if the driver is already
    // close to the weekly (56h) or fortnightly (90h) cap.
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
      continuous: 0,
    };
    driverById[d.id] = d;
  }

  const eligibleIds = Object.keys(forecast);

  // Drivers become available at 06:00 UTC on the target date, or immediately
  // if planning same-day jobs that are already overdue.
  const nominalStartMs = new Date(targetDate + "T06:00:00Z").getTime();
  const baseStartMs = Math.max(nominalStartMs, nowMs);

  // Wall-clock time each driver becomes free for their next job.
  // This is distinct from hoursLeft (compliance drive hours): it includes
  // loading/unloading dwell time at every stop so that chaining respects the
  // actual job finish time (e.g. driver finishes unloading at 12:40 PM, not
  // just when the truck arrives at the drop warehouse).
  const driverReadyMs: Record<string, number> = {};
  for (const did of eligibleIds) driverReadyMs[did] = baseStartMs;

  // Sort jobs by their scheduled pickup time (earliest first, unscheduled last).
  //
  // WHY: with a longest-first sort, a job that naturally chains AFTER another
  // (e.g. SBS2→SNG1 after a driver just dropped at SBS2) can be processed
  // first and assigned to a different driver — breaking the chain.  Sorting
  // chronologically ensures the planner assigns job-1 before job-2, so when
  // job-2 is evaluated the forecast position of the job-1 driver already
  // reflects their end location and they appear as distance-0 to the pickup.
  const pickupMs = (job: Job): number => {
    const s0 = stopsMap[job.id]?.[0];
    const iso = s0?.scheduled_at ?? job.scheduled_at ?? null;
    return iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER;
  };
  const sorted = [...jobs].sort((a, b) => pickupMs(a) - pickupMs(b));

  for (const job of sorted) {
    const stops = stopsMap[job.id] ?? [];
    const fp = firstPickupWh(stops, warehouses);
    if (!fp || stops.length === 0) {
      out.unassignable.push({ jobId: job.id, reason: "No stops / pickup configured" });
      continue;
    }

    // jobH = driving hours only (used for compliance / hoursLeft).
    const jobH = jobDriveHours(stops, warehouses);

    // jobWallH = total wall-clock hours the driver is occupied by this job,
    // including dwell (loading + checks at every stop). Used for chaining so
    // the next assignment starts after the driver finishes unloading.
    const dwellH = stops.reduce((s, st) => s + stopDwellMinutes(st.kind) / 60, 0);
    const jobWallH = jobH + dwellH;

    // Scheduled pickup time at the first stop, if the job has one.
    const schedPickupMs = (() => {
      const iso = stops[0]?.scheduled_at ?? job.scheduled_at ?? null;
      if (!iso) return null;
      const ms = new Date(iso).getTime();
      return Number.isFinite(ms) ? ms : null;
    })();

    let best: {
      id: string;
      dist: number;
      driveAdd: number;
      transit: number;
      departMs: number;
      breakMs: number;
    } | null = null;
    let nearMiss: { name: string; dist: number; reason: string } | null = null;

    for (const did of eligibleIds) {
      const f = forecast[did];
      const dist = haversineKm(f.lat, f.lon, fp.latitude, fp.longitude);
      const transit = transitTimeHours(dist);
      const driveAdd = jobH + transit;

      const breakMs = calculateBreakDelayMs(f.continuous, driveAdd);

      if (f.hoursLeft < driveAdd + breakMs / 3_600_000) {
        const reason = `needs ${driveAdd.toFixed(1)}h drive, ${f.hoursLeft.toFixed(1)}h left`;
        if (!nearMiss || dist < nearMiss.dist)
          nearMiss = { name: driverById[did].name, dist, reason };
        continue;
      }

      // Departure time: driver leaves as late as possible to arrive exactly at
      // the scheduled pickup, but cannot leave before they finish their previous
      // job (driverReadyMs). If there is no scheduled pickup time the driver
      // departs as soon as they are free.
      const readyMs = driverReadyMs[did];
      const transitMs = transit * 3_600_000;
      const departMs =
        schedPickupMs !== null ? Math.max(readyMs, schedPickupMs - transitMs) : readyMs;

      if (!best || dist < best.dist) best = { id: did, dist, driveAdd, transit, departMs, breakMs };
    }

    if (!best) {
      const reason = nearMiss
        ? `Closest: ${nearMiss.name} — ${nearMiss.reason}`
        : eligibleIds.length === 0
          ? `No drivers available for ${targetDate}`
          : "No eligible driver";
      out.unassignable.push({ jobId: job.id, reason });
      continue;
    }

    const f = forecast[best.id];
    const seq = ++f.sequence;

    // Arrival at first pickup (may be after scheduled time if driver was busy)
    const arrivalMs = best.departMs + best.transit * 3_600_000;
    // Effective pickup start: whichever is later — arrival or the scheduled time
    const pickupStartMs = schedPickupMs !== null ? Math.max(arrivalMs, schedPickupMs) : arrivalMs;
    // Driver is free again after completing all stops including unloading dwell + any break
    driverReadyMs[best.id] = pickupStartMs + jobWallH * 3_600_000 + best.breakMs;

    const c = compliance[best.id];
    const weeklyBase = c?.weekly ?? 0;
    const nextWeekly = weeklyBase + best.driveAdd;

    out.planned.push({
      jobId: job.id,
      driverId: best.id,
      sequence: seq,
      startAt: new Date(best.departMs).toISOString(),
      distKm: best.dist,
      dailyHoursLeft: Math.max(0, f.hoursLeft - best.driveAdd),
      weeklyHoursLeft: Math.max(0, WEEKLY_CAP - nextWeekly),
    });

    const ld = lastDropWh(stops, warehouses);
    f.lat = ld?.latitude ?? f.lat;
    f.lon = ld?.longitude ?? f.lon;
    f.hoursLeft -= best.driveAdd;
    f.continuous =
      best.breakMs > 0
        ? Math.max(0, best.driveAdd - BREAK_THRESHOLD_HOURS)
        : f.continuous + best.driveAdd;
  }

  return out;
}

// Backwards-compat alias — still used by tomorrow.functions.ts.
// New code should call computePlanForDate directly.
export function computeTomorrowPlan(
  tomorrowJobs: Job[],
  stopsMap: StopsMap,
  drivers: Driver[],
  warehouses: Warehouse[],
  compliance: Record<string, Compliance>,
  shifts: Record<string, DriverShift> = {},
  overrides: DriverAvailabilityOverride[] = [],
): PlanResult {
  const tomorrowStr = tomorrowISODate(Date.now());
  return computePlanForDate(
    tomorrowStr,
    tomorrowJobs,
    stopsMap,
    drivers,
    warehouses,
    compliance,
    shifts,
    overrides,
  );
}
