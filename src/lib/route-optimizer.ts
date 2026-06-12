// Route optimizer for carrier dispatch.
//
// Replaces the greedy "closest pickup wins" assignment with a real optimizer:
//   Phase 1 — regret-2 insertion: repeatedly place the hardest-to-cover job
//             (largest gap between its best and 2nd-best insertion) into its
//             cheapest feasible slot across all drivers.
//   Phase 2 — local search: relocate single jobs and swap pairs between drivers,
//             accepting only moves that lower the global objective; retry
//             uncovered jobs as capacity frees up.
//
// Objective (lexicographic via weights W_UNCOVERED >> W_DEADHEAD >> W_LATE >> W_BALANCE):
//   1. maximize covered loads   2. minimize empty (deadhead) km
//   3. minimize lateness        4. balance driver hours
//
// Routes are evaluated from scratch each time (robust over fragile incremental
// state). Hard constraints: HGV daily/weekly driving caps (seeded from the real
// hours ledger), 4.5h break rule, shift window (incl. overnight), equipment
// match, and return-to-base. Deterministic: all iteration is sorted by id.

import type { Warehouse } from "./types";
import { haversineKm, transitTimeHours, stopDwellMinutes, ARRIVAL_BUFFER_MINUTES } from "./geo";
import type { PlannerStop } from "./planner";

const WEEKLY_CAP = 56;
const FORTNIGHT_CAP = 90;
const BREAK_THRESHOLD_HOURS = 4.5;
const BREAK_DURATION_MS = 45 * 60_000;
const H = 3_600_000;

const W_UNCOVERED = 1e6;
const W_DEADHEAD = 100;
const W_LATE = 500;
const W_BALANCE = 0.1;
// Credibility backstop: the optimizer will not schedule a pickup or delivery
// later than this many minutes — the load is left uncovered instead.
const MAX_LATE_MINUTES = 60;

// A point the optimizer travels to/from. whId is set when it's a warehouse, so
// a TravelProvider can use real lane times; the driver's GPS start has none.
export interface GeoPoint {
  lat: number;
  lon: number;
  whId?: string;
}
// Returns travel time in HOURS. departMs lets providers pick time-of-day lanes.
export type TravelFn = (from: GeoPoint, to: GeoPoint, departMs: number) => number;

export interface OptDriver {
  id: string;
  lat: number;
  lon: number;
  readyMs: number; // available-from (shift start floored at now)
  shiftEndMs: number | null; // null = no shift-end cap
  hoursLeft: number; // remaining daily driving budget (h), already net of the ledger
  weeklyUsed: number; // driving hours used this week (from the ledger)
  fortnightUsed: number; // driving hours used over the last 14 days (from the ledger)
  homeWarehouseId: string | null; // set only when return-to-base is required
  equipment?: string[]; // capabilities; omitted = can take anything
}

export interface OptJob {
  id: string;
  stops: PlannerStop[];
  equipmentType?: string | null; // required equipment; null/omitted = no requirement
}

export interface OptAssignment {
  jobId: string;
  driverId: string;
  sequence: number;
  startAt: string;
  arriveAt: string;
  lateMinutes: number;
}
export interface OptReturnLeg {
  driverId: string;
  fromWarehouseId: string;
  homeWarehouseId: string;
  distKm: number;
  loaded: boolean;
  arriveAt: string;
}
export interface OptRouteSummary {
  driverId: string;
  startAt: string;
  endAt: string; // includes the return-to-base leg when present
  driveHours: number;
  deadheadKm: number;
  endsAtHome: boolean;
}
export interface OptResult {
  assignments: OptAssignment[];
  returns: OptReturnLeg[];
  routeSummaries: OptRouteSummary[];
  uncovered: { jobId: string; reason: string }[];
  metrics: {
    coveredJobs: number;
    totalJobs: number;
    totalDeadheadKm: number;
    totalLateMinutes: number;
    driverHours: Record<string, number>;
  };
}

export interface OptInput {
  drivers: OptDriver[];
  jobs: OptJob[];
  warehouses: Warehouse[];
  travelHours?: TravelFn;
  canTake?: (d: OptDriver, j: OptJob) => boolean;
  maxLocalSearchPasses?: number;
}

type PerJob = { jobId: string; startMs: number; arriveMs: number; lateMinutes: number };
type RouteEval = {
  deadheadKm: number;
  driveH: number;
  lateMin: number;
  endMs: number;
  perJob: PerJob[];
  returnLeg: OptReturnLeg | null;
};

const defaultTravelHours: TravelFn = (from, to) =>
  transitTimeHours(haversineKm(from.lat, from.lon, to.lat, to.lon));

// Default equipment rule: a job with no requirement is takeable by anyone; a
// driver with no declared equipment can take anything; otherwise the driver's
// capability set must include the job's required type.
function defaultCanTake(d: OptDriver, j: OptJob): boolean {
  if (!j.equipmentType) return true;
  if (!d.equipment || d.equipment.length === 0) return true;
  return d.equipment.includes(j.equipmentType);
}

function breakMsFor(
  currentContinuous: number,
  driveAdd: number,
): { breakMs: number; newCont: number } {
  let cont = currentContinuous;
  let rem = driveAdd;
  let breaks = 0;
  while (cont + rem > BREAK_THRESHOLD_HOURS) {
    rem -= BREAK_THRESHOLD_HOURS - cont;
    cont = 0;
    breaks += 1;
  }
  return { breakMs: breaks * BREAK_DURATION_MS, newCont: cont + rem };
}

export function optimizeRoutes(input: OptInput): OptResult {
  const travel = input.travelHours ?? defaultTravelHours;
  const canTake = input.canTake ?? defaultCanTake;
  const maxPasses = input.maxLocalSearchPasses ?? 4;

  const whById: Record<string, Warehouse> = {};
  for (const w of input.warehouses) whById[w.id] = w;
  const jobById: Record<string, OptJob> = {};
  for (const j of input.jobs) jobById[j.id] = j;

  const firstPickup = (stops: PlannerStop[]) => {
    const s = stops.find((x) => x.kind === "PICKUP") ?? stops[0];
    return s ? (whById[s.warehouse_id] ?? null) : null;
  };
  const lastDrop = (stops: PlannerStop[]) => {
    const s = [...stops].reverse().find((x) => x.kind === "DROP") ?? stops[stops.length - 1];
    return s ? (whById[s.warehouse_id] ?? null) : null;
  };
  const schedMs = (iso: string | null | undefined) => {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
  };

  const drivers = [...input.drivers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const driverById: Record<string, OptDriver> = {};
  for (const d of drivers) driverById[d.id] = d;

  // Loaded driving + total wall time for a job's own stops, computed via the
  // TravelFn (so lane times apply to the loaded legs too, not just deadhead).
  const jobLegs = (
    stops: PlannerStop[],
    departHintMs: number,
  ): { driveH: number; wallH: number } | null => {
    let driveMin = 0;
    let cur = departHintMs;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = whById[stops[i].warehouse_id];
      const b = whById[stops[i + 1].warehouse_id];
      if (!a || !b) return null;
      cur += stopDwellMinutes(stops[i].kind) * 60_000;
      const legMin =
        Math.round(
          travel(
            { lat: a.latitude, lon: a.longitude, whId: a.id },
            { lat: b.latitude, lon: b.longitude, whId: b.id },
            cur,
          ) * 60,
        ) + ARRIVAL_BUFFER_MINUTES;
      driveMin += legMin;
      cur += legMin * 60_000;
    }
    const dwellMin = stops.reduce((s, st) => s + stopDwellMinutes(st.kind), 0);
    return { driveH: driveMin / 60, wallH: (driveMin + dwellMin) / 60 };
  };

  // Evaluate a full route from scratch. Returns null if any hard constraint breaks.
  function evaluate(driver: OptDriver, jobIds: string[]): RouteEval | null {
    let lat = driver.lat;
    let lon = driver.lon;
    let lastWhId: string | null = null;
    let t = driver.readyMs;
    let dayDrive = 0;
    let weekDrive = driver.weeklyUsed;
    let fortDrive = driver.fortnightUsed;
    let cont = 0;
    let deadheadKm = 0;
    let lateMin = 0;
    const perJob: PerJob[] = [];

    for (const jid of jobIds) {
      const job = jobById[jid];
      if (!job) return null;
      if (!canTake(driver, job)) return null;
      const fp = firstPickup(job.stops);
      const ld = lastDrop(job.stops);
      if (!fp || !ld) return null;

      const ddKm = haversineKm(lat, lon, fp.latitude, fp.longitude);
      const legTo = travel(
        { lat, lon, whId: lastWhId ?? undefined },
        { lat: fp.latitude, lon: fp.longitude, whId: fp.id },
        t,
      );
      // Pickup scheduled = CPT (Critical Pull Time = the depart deadline). The
      // truck must ARRIVE by CPT − loading so it can load and pull on time.
      const sched = schedMs(job.stops[0]?.scheduled_at);
      const loadMs = stopDwellMinutes(job.stops[0]?.kind ?? "PICKUP") * 60_000;
      const arriveBy = sched !== null ? sched - loadMs : null;
      const legToMs = legTo * H;
      const departMs = arriveBy !== null ? Math.max(t, arriveBy - legToMs) : t;
      const arriveMs = departMs + legToMs;
      const pickupStartMs = arriveBy !== null ? Math.max(arriveMs, arriveBy) : arriveMs;

      const legs = jobLegs(job.stops, pickupStartMs);
      if (!legs) return null;
      const driveAdd = legTo + legs.driveH;

      if (dayDrive + driveAdd > driver.hoursLeft) return null;
      if (weekDrive + driveAdd > WEEKLY_CAP) return null;
      if (fortDrive + driveAdd > FORTNIGHT_CAP) return null;

      const { breakMs, newCont } = breakMsFor(cont, driveAdd);
      const completionMs = pickupStartMs + legs.wallH * H + breakMs;

      if (driver.shiftEndMs != null && completionMs > driver.shiftEndMs) return null;

      const pickupLate =
        arriveBy !== null ? Math.max(0, Math.round((arriveMs - arriveBy) / 60_000)) : 0;
      const dropSched = schedMs(job.stops[job.stops.length - 1]?.scheduled_at);
      const finalDwellMs = stopDwellMinutes(job.stops[job.stops.length - 1].kind) * 60_000;
      const deliveryLate =
        dropSched !== null
          ? Math.max(0, Math.round((completionMs - finalDwellMs - dropSched) / 60_000))
          : 0;
      if (pickupLate > MAX_LATE_MINUTES || deliveryLate > MAX_LATE_MINUTES) return null;

      dayDrive += driveAdd;
      weekDrive += driveAdd;
      fortDrive += driveAdd;
      cont = newCont;
      deadheadKm += ddKm;
      lateMin += pickupLate + deliveryLate;
      lat = ld.latitude;
      lon = ld.longitude;
      lastWhId = ld.id;
      t = completionMs;
      perJob.push({
        jobId: jid,
        startMs: departMs,
        arriveMs,
        lateMinutes: pickupLate + deliveryLate,
      });
    }

    // Return-to-base (only if required and the driver actually worked).
    let returnLeg: OptReturnLeg | null = null;
    if (driver.homeWarehouseId && jobIds.length > 0) {
      const home = whById[driver.homeWarehouseId];
      if (home) {
        const returnKm = haversineKm(lat, lon, home.latitude, home.longitude);
        const returnH = travel(
          { lat, lon, whId: lastWhId ?? undefined },
          { lat: home.latitude, lon: home.longitude, whId: home.id },
          t,
        );
        if (dayDrive + returnH > driver.hoursLeft) return null;
        if (weekDrive + returnH > WEEKLY_CAP) return null;
        if (fortDrive + returnH > FORTNIGHT_CAP) return null;
        const homeArriveMs = t + returnH * H;
        if (driver.shiftEndMs != null && homeArriveMs > driver.shiftEndMs) return null;
        deadheadKm += returnKm;
        dayDrive += returnH;
        weekDrive += returnH;
        fortDrive += returnH;
        returnLeg = {
          driverId: driver.id,
          fromWarehouseId: lastWhId ?? home.id,
          homeWarehouseId: home.id,
          distKm: returnKm,
          loaded: lastWhId === home.id,
          arriveAt: new Date(homeArriveMs).toISOString(),
        };
      }
    }

    return {
      deadheadKm,
      driveH: dayDrive,
      lateMin,
      endMs: returnLeg ? Date.parse(returnLeg.arriveAt) : t,
      perJob,
      returnLeg,
    };
  }

  const routes: Record<string, string[]> = {};
  for (const d of drivers) routes[d.id] = [];

  const routeCost = (ev: RouteEval | null): number =>
    ev ? W_DEADHEAD * ev.deadheadKm + W_LATE * ev.lateMin : Infinity;

  const solutionCost = (rs: Record<string, string[]>): number => {
    let dh = 0;
    let late = 0;
    let placed = 0;
    const driveHs: number[] = [];
    for (const d of drivers) {
      const ev = evaluate(d, rs[d.id]);
      if (!ev) return Infinity;
      if (rs[d.id].length > 0) {
        dh += ev.deadheadKm;
        late += ev.lateMin;
        driveHs.push(ev.driveH);
        placed += rs[d.id].length;
      }
    }
    const uncovered = input.jobs.length - placed;
    const balance = driveHs.length ? Math.max(...driveHs) - Math.min(...driveHs) : 0;
    return W_UNCOVERED * uncovered + W_DEADHEAD * dh + W_LATE * late + W_BALANCE * balance;
  };

  // Best feasible insertion of a job into a driver's current route.
  type Insertion = { driverId: string; pos: number; marginal: number };
  const bestInsertion = (jid: string, excludeDriver?: string): Insertion | null => {
    let best: Insertion | null = null;
    for (const d of drivers) {
      if (d.id === excludeDriver) continue;
      const cur = routes[d.id];
      const base = routeCost(evaluate(d, cur));
      for (let p = 0; p <= cur.length; p++) {
        const cand = [...cur.slice(0, p), jid, ...cur.slice(p)];
        const ev = evaluate(d, cand);
        if (!ev) continue;
        const marginal = routeCost(ev) - base;
        if (
          !best ||
          marginal < best.marginal ||
          (marginal === best.marginal && d.id < best.driverId)
        ) {
          best = { driverId: d.id, pos: p, marginal };
        }
      }
    }
    return best;
  };

  // --- Phase 1: regret-2 insertion ---
  const unplaced = new Set(input.jobs.map((j) => j.id));
  const uncovered: { jobId: string; reason: string }[] = [];

  while (unplaced.size > 0) {
    let pick: { jid: string; ins: Insertion } | null = null;
    let pickRegret = -Infinity;
    const stillUnplaceable: string[] = [];

    for (const jid of [...unplaced].sort()) {
      const top: number[] = [];
      let bestIns: Insertion | null = null;
      for (const d of drivers) {
        const cur = routes[d.id];
        const base = routeCost(evaluate(d, cur));
        for (let p = 0; p <= cur.length; p++) {
          const ev = evaluate(d, [...cur.slice(0, p), jid, ...cur.slice(p)]);
          if (!ev) continue;
          const marginal = routeCost(ev) - base;
          top.push(marginal);
          if (
            !bestIns ||
            marginal < bestIns.marginal ||
            (marginal === bestIns.marginal && d.id < bestIns.driverId)
          ) {
            bestIns = { driverId: d.id, pos: p, marginal };
          }
        }
      }
      if (!bestIns) {
        stillUnplaceable.push(jid);
        continue;
      }
      top.sort((a, b) => a - b);
      const regret = (top.length > 1 ? top[1] : W_UNCOVERED) - top[0];
      if (regret > pickRegret || (regret === pickRegret && (!pick || jid < pick.jid))) {
        pickRegret = regret;
        pick = { jid, ins: bestIns };
      }
    }

    for (const jid of stillUnplaceable) {
      unplaced.delete(jid);
      uncovered.push({
        jobId: jid,
        reason: "No feasible driver (hours / shift / window / equipment / return-to-base)",
      });
    }
    if (!pick) break;
    routes[pick.ins.driverId].splice(pick.ins.pos, 0, pick.jid);
    unplaced.delete(pick.jid);
  }

  // --- Phase 2: local search (relocate + swap), retry uncovered ---
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;

    // Relocate each placed job to its best feasible slot.
    for (const d of drivers) {
      for (let i = 0; i < routes[d.id].length; i++) {
        const jid = routes[d.id][i];
        const before = solutionCost(routes);
        routes[d.id].splice(i, 1);
        const ins = bestInsertion(jid);
        if (ins) {
          routes[ins.driverId].splice(ins.pos, 0, jid);
          if (solutionCost(routes) < before - 1e-9) {
            improved = true;
            i = -1; // restart this driver's scan
            continue;
          }
          // revert
          const k = routes[ins.driverId].indexOf(jid);
          routes[ins.driverId].splice(k, 1);
        }
        routes[d.id].splice(i, 0, jid); // put back
      }
    }

    // Swap pairs of placed jobs across different drivers.
    const placedPairs: { d: string; i: number; jid: string }[] = [];
    for (const d of drivers)
      routes[d.id].forEach((jid, i) => placedPairs.push({ d: d.id, i, jid }));
    for (let a = 0; a < placedPairs.length; a++) {
      for (let b = a + 1; b < placedPairs.length; b++) {
        const A = placedPairs[a];
        const B = placedPairs[b];
        if (A.d === B.d) continue;
        // Read the ACTUAL job IDs from routes — the tracking array may be
        // stale after previous swaps within the same pass.
        const aJid = routes[A.d][A.i];
        const bJid = routes[B.d][B.i];
        if (aJid === bJid) continue;
        const before = solutionCost(routes);
        routes[A.d][A.i] = bJid;
        routes[B.d][B.i] = aJid;
        if (solutionCost(routes) < before - 1e-9) {
          improved = true;
          // Update tracking to match the new state.
          A.jid = bJid;
          B.jid = aJid;
        } else {
          routes[A.d][A.i] = aJid;
          routes[B.d][B.i] = bJid;
        }
      }
    }

    // Try to cover anything still uncovered.
    for (let u = uncovered.length - 1; u >= 0; u--) {
      const jid = uncovered[u].jobId;
      const ins = bestInsertion(jid);
      if (ins) {
        routes[ins.driverId].splice(ins.pos, 0, jid);
        uncovered.splice(u, 1);
        improved = true;
      }
    }

    if (!improved) break;
  }

  // --- Build result ---
  const assignments: OptAssignment[] = [];
  const returns: OptReturnLeg[] = [];
  const routeSummaries: OptRouteSummary[] = [];
  const driverHours: Record<string, number> = {};
  let totalDeadheadKm = 0;
  let totalLateMinutes = 0;
  let covered = 0;

  for (const d of drivers) {
    const ev = evaluate(d, routes[d.id]);
    if (!ev) continue;
    driverHours[d.id] = ev.driveH;
    totalDeadheadKm += ev.deadheadKm;
    totalLateMinutes += ev.lateMin;
    ev.perJob.forEach((pj, idx) => {
      covered += 1;
      assignments.push({
        jobId: pj.jobId,
        driverId: d.id,
        sequence: idx + 1,
        startAt: new Date(pj.startMs).toISOString(),
        arriveAt: new Date(pj.arriveMs).toISOString(),
        lateMinutes: pj.lateMinutes,
      });
    });
    if (ev.returnLeg) returns.push(ev.returnLeg);
    if (ev.perJob.length > 0) {
      routeSummaries.push({
        driverId: d.id,
        startAt: new Date(ev.perJob[0].startMs).toISOString(),
        endAt: new Date(ev.endMs).toISOString(),
        driveHours: ev.driveH,
        deadheadKm: Math.round(ev.deadheadKm * 100) / 100,
        endsAtHome: !!ev.returnLeg,
      });
    }
  }

  return {
    assignments,
    returns,
    routeSummaries,
    uncovered,
    metrics: {
      coveredJobs: covered,
      totalJobs: input.jobs.length,
      totalDeadheadKm: Math.round(totalDeadheadKm * 100) / 100,
      totalLateMinutes,
      driverHours,
    },
  };
}
