// Auto-planner for HGV jobs.
//
// computePlan (live, "now"):
//   Pass 1 — Immediate: free drivers within 30 km of the first PICKUP are
//     hard-assigned to PENDING jobs (closest wins).
//   Pass 2 — Planned chaining: project each driver's end location/time after
//     their current run + already-chained jobs, then find the closest reachable
//     next pickup that still fits HGV daily/weekly limits and the job's
//     scheduled pickup time (when known).
//   Pass 3 — Leftovers: jobs no driver can take are returned as `unassignable`.
//
// computePlanForDate (any date): calendar/shift-aware day planner that also
//   honours each driver's shift window (start AND end time) and routes
//   return-to-base drivers back to their home depot.

import type { Driver, Warehouse, Job, DriverShift, DriverAvailabilityOverride } from "./types";
import type { Compliance } from "./compliance";
import {
  haversineKm,
  transitTimeHours,
  stopDwellMinutes,
  projectPosition,
  ARRIVAL_BUFFER_MINUTES,
} from "./geo";

// Day-of-week for a YYYY-MM-DD string, computed in UTC so it is consistent
// regardless of the host timezone.
function utcDayOfWeek(dateStr: string): number {
  return new Date(dateStr + "T12:00:00Z").getUTCDay();
}

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
  if (!shift) return true;
  // Shift exists but zero working days = driver never works (e.g. contractor pause).
  if (shift.days_of_week.length === 0) return false;

  return shift.days_of_week.includes(utcDayOfWeek(dateStr));
}

function tomorrowISODate(nowMs: number): string {
  // Add 24h then take the UTC date — consistent with utcDayOfWeek / todayStr.
  return new Date(nowMs + 86_400_000).toISOString().slice(0, 10);
}

export const AUTO_ASSIGN_RADIUS_KM = 30;
// Planned chaining uses a wider radius: the driver's projected end-position
// is hours in the future so a strict 30 km cap is overly conservative.
const CHAIN_RADIUS_KM = 80;
// Standard HGV daily driving limit (h). 10h is only permitted twice a week, so
// we apply the conservative 9h cap consistently across both planners.
const DAILY_CAP = 9;
const WEEKLY_CAP = 56;
const FORTNIGHT_CAP = 90;
const MAX_PICKUP_SPEED_KMH = 100;
const ACTIVE = new Set(["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);

// HGV Break Rules (simplified UK/EU): a 45 min break is required for every
// 4.5h of accumulated driving.
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
  // Lateness vs the job's scheduled pickup/delivery, in minutes (0 = on time
  // or unscheduled). late = either is > 0. Populated by computePlanForDate.
  late?: boolean;
  pickupLateMinutes?: number;
  deliveryLateMinutes?: number;
};
export type Unassignable = { jobId: string; reason: string };
// Explicit final leg taking a return-to-base driver back to their home depot.
// loaded=true means a delivery job already ended at home (no empty running);
// loaded=false is an empty deadhead back to base (distKm > 0).
export type ReturnLeg = {
  driverId: string;
  sequence: number;
  fromWarehouseId: string;
  homeWarehouseId: string;
  startAt: string;
  arriveAt: string;
  distKm: number;
  loaded: boolean;
};

export type PlanResult = {
  immediate: ImmediateAssign[];
  planned: PlannedAssign[];
  unassignable: Unassignable[];
  returns: ReturnLeg[];
};

// Driving hours a job consumes once the driver is at the first stop: per-leg
// transit time (rounded to whole minutes) plus an arrival buffer per leg.
// NOTE: drive time ONLY — stop dwell (loading/unloading) is added separately by
// callers via jobDwellHours / jobWallHours.
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

// Total dwell (loading/unloading + checks) across all stops, in hours.
function jobDwellHours(stops: PlannerStop[]): number {
  return stops.reduce((s, st) => s + stopDwellMinutes(st.kind) / 60, 0);
}

// Total wall-clock hours a driver is occupied by a job: drive + dwell.
export function jobWallHours(stops: PlannerStop[], warehouses: Warehouse[]): number {
  return jobDriveHours(stops, warehouses) + jobDwellHours(stops);
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

// Driver working window for targetDate, in epoch ms. startMs is floored at
// nowMs. endMs is null when no end_time is configured (skip end-of-shift check).
function timeToMs(targetDate: string, raw: string | undefined | null): number | null {
  if (!raw) return null;
  const norm = raw.length === 5 ? raw + ":00" : raw;
  const ms = new Date(`${targetDate}T${norm}Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}
export function shiftWindowMs(
  targetDate: string,
  shift: DriverShift | undefined,
  nowMs: number,
): { startMs: number; endMs: number | null } {
  const day = shift?.shiftByDay?.[utcDayOfWeek(targetDate)];
  const startBase = timeToMs(targetDate, day?.start_time ?? "06:00:00");
  let endMs = timeToMs(targetDate, day?.end_time);
  // end <= start means the shift crosses midnight into the next day (e.g. 18:00–02:00).
  if (endMs != null && startBase != null && endMs <= startBase) endMs += 86_400_000;
  return { startMs: Math.max(startBase ?? nowMs, nowMs), endMs };
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

  const nextWh = warehouses.find((w) => w.id === remaining[0].warehouse_id);
  const deadheadKm = nextWh
    ? haversineKm(driver.current_lat, driver.current_lon, nextWh.latitude, nextWh.longitude)
    : 0;
  return transitTimeHours(deadheadKm) + jobDriveHours(remaining, warehouses);
}

/**
 * Break planning for `driveAdd` hours of driving that begins after
 * `currentContinuous` hours already driven since the last break. Inserts a
 * 45 min break for every 4.5h driving boundary crossed, and returns the
 * resulting continuous driving hours after this leg.
 */
function breakInfo(
  currentContinuous: number,
  driveAdd: number,
): { breakMs: number; newContinuous: number } {
  let continuous = currentContinuous;
  let remaining = driveAdd;
  let breaks = 0;
  while (continuous + remaining > BREAK_THRESHOLD_HOURS) {
    remaining -= BREAK_THRESHOLD_HOURS - continuous;
    continuous = 0;
    breaks += 1;
  }
  return {
    breakMs: breaks * BREAK_DURATION_MINUTES * 60_000,
    newContinuous: continuous + remaining,
  };
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
  const out: PlanResult = { immediate: [], planned: [], unassignable: [], returns: [] };
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const hasShiftData = Object.keys(shifts).length > 0;

  const eligible = drivers
    .filter(
      (d) =>
        d.current_lat != null &&
        d.current_lon != null &&
        !compliance[d.id]?.blockAssignment &&
        (!hasShiftData || isDriverAvailableOnDate(d.id, todayStr, shifts, overrides)),
    )
    // Stable order so equidistant ties don't break differently between runs.
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const activeByDriver: Record<string, Job> = {};
  for (const j of jobs) {
    if (j.assigned_driver_id && ACTIVE.has(j.status)) activeByDriver[j.assigned_driver_id] = j;
  }

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
      const dwell = jobDwellHours(remaining);
      forecast[d.id] = {
        lat: ld?.latitude ?? d.current_lat!,
        lon: ld?.longitude ?? d.current_lon!,
        endMs: nowMs + (drive + dwell) * 3_600_000,
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

  const schedPickupMsOf = (job: Job, stops: PlannerStop[]): number | null => {
    const iso = stops[0]?.scheduled_at ?? job.scheduled_at ?? null;
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
  };

  // --- Pass 1: immediate ---
  for (const job of pending) {
    const stops = stopsMap[job.id];
    const fp = firstPickupWh(stops, warehouses);
    if (!fp || !stops) continue;

    const isTomorrowJob = (job.for_date ?? null) === tomorrow;
    const schedPickupMs = schedPickupMsOf(job, stops);
    const jobH = jobDriveHours(stops, warehouses);
    const dwellH = jobDwellHours(stops);

    let best: { d: Driver; dist: number; driveAdd: number } | null = null;
    for (const d of eligible) {
      if (activeByDriver[d.id]) continue;
      if (compliance[d.id]?.blockAssignment) continue;
      if (isTomorrowJob) {
        const ok = hasShiftData ? isDriverAvailableOnDate(d.id, tomorrow, shifts, overrides) : true;
        if (!ok) continue;
      }

      const dist = haversineKm(d.current_lat!, d.current_lon!, fp.latitude, fp.longitude);
      if (dist > AUTO_ASSIGN_RADIUS_KM) continue;

      const transit = transitTimeHours(dist);
      const driveAdd = jobH + transit;
      const f = forecast[d.id];

      if (schedPickupMs !== null) {
        const timeAvailableMs = schedPickupMs - nowMs;
        if (timeAvailableMs > 0) {
          const requiredSpeed = dist / (timeAvailableMs / 3_600_000);
          if (requiredSpeed > MAX_PICKUP_SPEED_KMH) continue;
        }
      }

      if (f.daily + driveAdd > DAILY_CAP) continue;
      if (f.weekly + driveAdd > WEEKLY_CAP) continue;
      if (!best || dist < best.dist) best = { d, dist, driveAdd };
    }
    if (best) {
      const f = forecast[best.d.id];
      const { breakMs, newContinuous } = breakInfo(f.continuous, best.driveAdd);
      out.immediate.push({ jobId: job.id, driverId: best.d.id, distKm: best.dist });
      claimed.add(job.id);
      activeByDriver[best.d.id] = job;
      const ld = lastDropWh(stops, warehouses);
      f.lat = ld?.latitude ?? f.lat;
      f.lon = ld?.longitude ?? f.lon;
      f.endMs += (best.driveAdd + dwellH) * 3_600_000 + breakMs;
      f.daily += best.driveAdd;
      f.weekly += best.driveAdd;
      f.continuous = newContinuous;
    }
  }

  // --- Pass 2: planned chaining onto driver forecasts ---
  for (const job of pending) {
    if (claimed.has(job.id)) continue;
    const stops = stopsMap[job.id];
    const fp = firstPickupWh(stops, warehouses);
    if (!fp || !stops) continue;

    const isTomorrowJob = (job.for_date ?? null) === tomorrow;
    const schedPickupMs = schedPickupMsOf(job, stops);
    const jobH = jobDriveHours(stops, warehouses);
    const dwellH = jobDwellHours(stops);

    let best: { d: Driver; dist: number; driveAdd: number; transit: number } | null = null;
    let nearMiss: { name: string; dist: number; reason: string } | null = null;

    for (const d of eligible) {
      if (isTomorrowJob) {
        const ok = hasShiftData ? isDriverAvailableOnDate(d.id, tomorrow, shifts, overrides) : true;
        if (!ok) continue;
      }
      const f = forecast[d.id];
      const dist = haversineKm(f.lat, f.lon, fp.latitude, fp.longitude);
      const transit = transitTimeHours(dist);
      const driveAdd = jobH + transit;

      const overRadius = dist > CHAIN_RADIUS_KM;
      const overDaily = f.daily + driveAdd > DAILY_CAP;
      const overWeekly = f.weekly + driveAdd > WEEKLY_CAP;
      let impossible = false;
      if (!overRadius && !overDaily && !overWeekly && schedPickupMs !== null) {
        const timeAvailableMs = schedPickupMs - f.endMs;
        if (timeAvailableMs > 0) {
          impossible = dist / (timeAvailableMs / 3_600_000) > MAX_PICKUP_SPEED_KMH;
        }
      }

      if (overRadius || overDaily || overWeekly || impossible) {
        const reason = overRadius
          ? `${dist.toFixed(1)} km from end of last run (limit ${CHAIN_RADIUS_KM} km)`
          : overDaily
            ? `would exceed daily ${(f.daily + driveAdd).toFixed(1)}/${DAILY_CAP}h`
            : overWeekly
              ? `would exceed weekly ${(f.weekly + driveAdd).toFixed(1)}/${WEEKLY_CAP}h`
              : `impossible route to make scheduled pickup`;
        if (!nearMiss || dist < nearMiss.dist) nearMiss = { name: d.name, dist, reason };
        continue;
      }
      if (!best || dist < best.dist) best = { d, dist, driveAdd, transit };
    }

    if (best) {
      const f = forecast[best.d.id];
      const { breakMs, newContinuous } = breakInfo(f.continuous, best.driveAdd);
      const arriveMs = f.endMs + best.transit * 3_600_000 + breakMs;
      const startMs = schedPickupMs !== null ? Math.max(arriveMs, schedPickupMs) : arriveMs;
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
      f.endMs = startMs + (jobH + dwellH) * 3_600_000;
      f.daily = nextDaily;
      f.weekly = nextWeekly;
      f.continuous = newContinuous;
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
 * Calendar availability + shift window (start AND end time) are enforced, and
 * weekly driving hours accumulate across all jobs assigned to a driver.
 *
 * Return-to-base: a driver with return_to_base_required = true and a non-null
 * home_warehouse_id must be able to get back to that depot. Every candidate
 * assignment reserves the drive-home leg in the daily/weekly budget, and — when
 * the driver has a shift end_time — requires arrival home before shift end.
 * A job whose last drop is already the home warehouse needs a zero-length
 * return (a "loaded" backhaul). After all jobs are placed, an explicit
 * ReturnLeg is emitted per such driver (loaded, or an empty deadhead home).
 * Drivers without the flag are flexible and unaffected.
 *
 * driverEquipment: driver_id → set of equipment_type strings the driver is
 * qualified to operate. When non-empty, a job with equipment_type set will
 * ONLY be assigned to drivers whose capabilities include that type. Drivers
 * with zero entries in the map have no equipment restrictions (backward
 * compatible — matches any job). Pass an empty map (or omit) to skip
 * equipment filtering entirely.
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
  driverEquipment: Record<string, Set<string>> = {},
): PlanResult {
  const out: PlanResult = { immediate: [], planned: [], unassignable: [], returns: [] };

  type TForecast = {
    lat: number;
    lon: number;
    hoursLeft: number;
    weekly: number;
    sequence: number;
    continuous: number;
    lastWhId?: string;
  };
  const forecast: Record<string, TForecast> = {};
  const driverById: Record<string, Driver> = {};
  // Home depot for return-to-base drivers only; null for flexible drivers.
  const homeWhById: Record<string, Warehouse | null> = {};

  for (const d of drivers) {
    if (!isDriverAvailableOnDate(d.id, targetDate, shifts, overrides)) continue;

    const startLat = d.current_lat ?? null;
    const startLon = d.current_lon ?? null;
    if (startLat == null || startLon == null) continue;

    const c = compliance[d.id];
    if (c?.blockAssignment) continue;

    let cap = DAILY_CAP;
    if (c) {
      if (c.weekly >= WEEKLY_CAP - DAILY_CAP) cap = Math.min(cap, WEEKLY_CAP - c.weekly);
      if (c.twoWeek >= FORTNIGHT_CAP - DAILY_CAP) cap = Math.min(cap, FORTNIGHT_CAP - c.twoWeek);
    }
    if (cap <= 0) continue;

    forecast[d.id] = {
      lat: startLat,
      lon: startLon,
      hoursLeft: cap,
      weekly: c?.weekly ?? 0,
      sequence: 0,
      continuous: 0,
    };
    driverById[d.id] = d;
    homeWhById[d.id] =
      d.return_to_base_required && d.home_warehouse_id
        ? warehouses.find((w) => w.id === d.home_warehouse_id) ?? null
        : null;
  }

  // Sorted for deterministic iteration: with no stable order, equidistant
  // ties would break differently depending on DB row order between runs.
  const eligibleIds = Object.keys(forecast).sort();

  const driverReadyMs: Record<string, number> = {};
  const shiftEndMsById: Record<string, number | null> = {};
  for (const did of eligibleIds) {
    const w = shiftWindowMs(targetDate, shifts[did], nowMs);
    driverReadyMs[did] = w.startMs;
    shiftEndMsById[did] = w.endMs;
  }

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

    const jobH = jobDriveHours(stops, warehouses);
    const jobWallH = jobWallHours(stops, warehouses);
    const jobLastDrop = lastDropWh(stops, warehouses);

    const schedPickupMs = (() => {
      const iso = stops[0]?.scheduled_at ?? job.scheduled_at ?? null;
      if (!iso) return null;
      const ms = new Date(iso).getTime();
      return Number.isFinite(ms) ? ms : null;
    })();

    // Scheduled delivery (last stop) and the dwell at that final stop, used to
    // flag late arrivals. arrival at the final drop = completion minus its dwell.
    const schedDropMs = (() => {
      const iso = stops[stops.length - 1]?.scheduled_at ?? null;
      if (!iso) return null;
      const ms = new Date(iso).getTime();
      return Number.isFinite(ms) ? ms : null;
    })();
    const finalDwellMs = stopDwellMinutes(stops[stops.length - 1].kind) * 60_000;

    let best:
      | {
          id: string;
          dist: number;
          driveAdd: number;
          transit: number;
          departMs: number;
          completionMs: number;
          newContinuous: number;
        }
      | null = null;
    let nearMiss: { name: string; dist: number; reason: string } | null = null;

    for (const did of eligibleIds) {
      const f = forecast[did];
      const dist = haversineKm(f.lat, f.lon, fp.latitude, fp.longitude);
      const transit = transitTimeHours(dist);
      const driveAdd = jobH + transit;
      const { breakMs, newContinuous } = breakInfo(f.continuous, driveAdd);
      const readyMs = driverReadyMs[did];

      // Equipment gate: when a job specifies equipment_type, only drivers
      // with that capability (or no equipment restrictions at all) can take it.
      const jobEquip = job.equipment_type || undefined;
      if (jobEquip) {
        const caps = driverEquipment[did];
        if (caps && caps.size > 0 && !caps.has(jobEquip)) {
          const reason = `Equipment mismatch: needs "${jobEquip}", driver has [${[...caps].join(", ")}]`;
          if (!nearMiss || dist < nearMiss.dist)
            nearMiss = { name: driverById[did].name, dist, reason };
          continue;
        }
      }

      // Return-to-base reservation: drive time from this job's last drop back
      // to the home depot (0 for flexible drivers, or if last drop IS home).
      const homeWh = homeWhById[did];
      const returnTransitH =
        homeWh && jobLastDrop
          ? transitTimeHours(
              haversineKm(
                jobLastDrop.latitude,
                jobLastDrop.longitude,
                homeWh.latitude,
                homeWh.longitude,
              ),
            )
          : 0;

      // IMPOSSIBLE ROUTE GUARD
      if (schedPickupMs !== null) {
        const timeAvailableMs = schedPickupMs - readyMs;
        if (timeAvailableMs > 0) {
          const requiredSpeed = dist / (timeAvailableMs / 3_600_000);
          if (requiredSpeed > MAX_PICKUP_SPEED_KMH) {
            const reason = `Impossible route: requires ${requiredSpeed.toFixed(0)} km/h`;
            if (!nearMiss || dist < nearMiss.dist)
              nearMiss = { name: driverById[did].name, dist, reason };
            continue;
          }
        }
      }

      // Daily DRIVING budget must cover the job AND the drive back to base.
      if (f.hoursLeft < driveAdd + returnTransitH) {
        const reason =
          returnTransitH > 0
            ? `needs ${driveAdd.toFixed(1)}h + ${returnTransitH.toFixed(1)}h home, ${f.hoursLeft.toFixed(1)}h left`
            : `needs ${driveAdd.toFixed(1)}h drive, ${f.hoursLeft.toFixed(1)}h left`;
        if (!nearMiss || dist < nearMiss.dist)
          nearMiss = { name: driverById[did].name, dist, reason };
        continue;
      }

      const transitMs = transit * 3_600_000;
      const departMs =
        schedPickupMs !== null ? Math.max(readyMs, schedPickupMs - transitMs) : readyMs;
      const arrivalMs = departMs + transitMs;
      const pickupStartMs = schedPickupMs !== null ? Math.max(arrivalMs, schedPickupMs) : arrivalMs;
      const completionMs = pickupStartMs + jobWallH * 3_600_000 + breakMs;

      // Must be back at base (or, for flexible drivers, just finish the job)
      // before shift end, when a shift end exists.
      const endMs = shiftEndMsById[did];
      const homeArrivalMs = completionMs + returnTransitH * 3_600_000;
      if (endMs != null && homeArrivalMs > endMs) {
        const reason =
          returnTransitH > 0
            ? `can't return to base before shift end (${new Date(endMs).toISOString().slice(11, 16)})`
            : `would finish after shift end (${new Date(endMs).toISOString().slice(11, 16)})`;
        if (!nearMiss || dist < nearMiss.dist)
          nearMiss = { name: driverById[did].name, dist, reason };
        continue;
      }

      if (!best || dist < best.dist)
        best = { id: did, dist, driveAdd, transit, departMs, completionMs, newContinuous };
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
    driverReadyMs[best.id] = best.completionMs;
    const nextWeekly = f.weekly + best.driveAdd;

    // Lateness: arrival at first pickup vs its schedule, and arrival at the
    // final drop (completion minus that stop's dwell) vs its schedule.
    const schedDropMs = (() => {
      const iso = stops[stops.length - 1]?.scheduled_at ?? null;
      if (!iso) return null;
      const ms = new Date(iso).getTime();
      return Number.isFinite(ms) ? ms : null;
    })();
    const finalDwellMs = stopDwellMinutes(stops[stops.length - 1].kind) * 60_000;
    const pickupArrivalMs = best.departMs + best.transit * 3_600_000;
    const deliveryArrivalMs = best.completionMs - finalDwellMs;
    const pickupLateMinutes =
      schedPickupMs !== null ? Math.max(0, Math.round((pickupArrivalMs - schedPickupMs) / 60_000)) : 0;
    const deliveryLateMinutes =
      schedDropMs !== null ? Math.max(0, Math.round((deliveryArrivalMs - schedDropMs) / 60_000)) : 0;

    out.planned.push({
      jobId: job.id,
      driverId: best.id,
      sequence: seq,
      startAt: new Date(best.departMs).toISOString(),
      distKm: best.dist,
      dailyHoursLeft: Math.max(0, f.hoursLeft - best.driveAdd),
      weeklyHoursLeft: Math.max(0, WEEKLY_CAP - nextWeekly),
      late: pickupLateMinutes > 0 || deliveryLateMinutes > 0,
      pickupLateMinutes,
      deliveryLateMinutes,
    });

    const ld = lastDropWh(stops, warehouses);
    f.lat = ld?.latitude ?? f.lat;
    f.lon = ld?.longitude ?? f.lon;
    f.lastWhId = ld?.id ?? f.lastWhId;
    f.hoursLeft -= best.driveAdd;
    f.weekly = nextWeekly;
    f.continuous = best.newContinuous;
  }

  // Emit an explicit return-to-base leg for every return-to-base driver that
  // worked today. loaded=true when their final delivery already ended at home.
  for (const did of eligibleIds) {
    const homeWh = homeWhById[did];
    const f = forecast[did];
    if (!homeWh || f.sequence === 0) continue;
    const returnKm = haversineKm(f.lat, f.lon, homeWh.latitude, homeWh.longitude);
    const startMs = driverReadyMs[did];
    const arriveMs = startMs + transitTimeHours(returnKm) * 3_600_000;
    out.returns.push({
      driverId: did,
      sequence: f.sequence + 1,
      fromWarehouseId: f.lastWhId ?? homeWh.id,
      homeWarehouseId: homeWh.id,
      startAt: new Date(startMs).toISOString(),
      arriveAt: new Date(arriveMs).toISOString(),
      distKm: returnKm,
      loaded: f.lastWhId === homeWh.id,
    });
  }

  return out;
}
