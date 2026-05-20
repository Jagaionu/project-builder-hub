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
import { haversineKm, transitTimeHours, LOADING_MINUTES } from "./geo";

export const AUTO_ASSIGN_RADIUS_KM = 30;
const DAILY_CAP = 10;
const WEEKLY_CAP = 56;
const ACTIVE = new Set(["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);

export type PlannerStop = { kind: "PICKUP" | "DROP"; warehouse_id: string };
export type StopsMap = Record<string, PlannerStop[]>;

export type ImmediateAssign = { jobId: string; driverId: string; distKm: number };
export type PlannedAssign = {
  jobId: string;
  driverId: string;
  sequence: number;
  startAt: string;
  distKm: number;
};
export type Unassignable = { jobId: string; reason: string };

export type PlanResult = {
  immediate: ImmediateAssign[];
  planned: PlannedAssign[];
  unassignable: Unassignable[];
};

function jobDriveHours(stops: PlannerStop[], warehouses: Warehouse[]): number {
  let h = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = warehouses.find((w) => w.id === stops[i].warehouse_id);
    const b = warehouses.find((w) => w.id === stops[i + 1].warehouse_id);
    if (!a || !b) continue;
    h += transitTimeHours(haversineKm(a.latitude, a.longitude, b.latitude, b.longitude));
  }
  const pickups = stops.filter((s) => s.kind === "PICKUP").length;
  h += (pickups * LOADING_MINUTES) / 60;
  return h;
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
      (d.status === "AVAILABLE" || d.status === "ON_SHIFT") &&
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
      const ld = lastDropWh(stops, warehouses);
      const drive = stops ? jobDriveHours(stops, warehouses) : 0;
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

  // --- Pass 1: immediate (free drivers within radius of pickup) ---
  for (const job of pending) {
    const stops = stopsMap[job.id];
    const fp = firstPickupWh(stops, warehouses);
    if (!fp || !stops) continue;

    let best: { d: Driver; dist: number; driveAdd: number } | null = null;
    for (const d of eligible) {
      if (activeByDriver[d.id]) continue;
      if (compliance[d.id]?.blockAssignment) continue;
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
      out.planned.push({
        jobId: job.id,
        driverId: best.d.id,
        sequence: seq,
        startAt: new Date(startMs).toISOString(),
        distKm: best.dist,
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
