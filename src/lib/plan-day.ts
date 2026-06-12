// plan-day.ts — Worker entry point for the new optimizer pipeline.
//
// Maps domain types (Driver, Job, Warehouse, StopsMap, Compliance, etc.) into
// the optimizer's input types (OptDriver, OptJob) and calls optimizeRoutes.
//
// Pure and deterministic: all iteration is sorted by id, and nowMs is pinned
// by the caller (worker). Accepts optional travelHours (from lane_travel_times),
// ledger totals, and driver equipment capabilities.

import type { Driver, Warehouse, Job, DriverShift, DriverAvailabilityOverride } from "@/lib/types";
import type { StopsMap } from "@/lib/planner";
import { shiftWindowMs, isDriverAvailableOnDate } from "@/lib/planner";
import { computeCompliance } from "@/lib/compliance";
import type { LedgerTotals } from "@/lib/compliance";
import type { TravelFn } from "@/lib/route-optimizer";
import { optimizeRoutes, type OptDriver, type OptJob, type OptResult } from "@/lib/route-optimizer";
import { haversineKm } from "@/lib/geo";

export interface PlanDayInput {
  targetDate: string;
  jobs: Job[];
  stopsMap: StopsMap;
  drivers: Driver[];
  warehouses: Warehouse[];
  ledger: Record<string, LedgerTotals>;
  shifts: Record<string, DriverShift>;
  overrides: DriverAvailabilityOverride[];
  travelHours?: TravelFn;
  driverEquipment?: Record<string, Set<string>>;
  nowMs: number;
}

const DAILY_CAP = 9;
const WEEKLY_CAP = 56;
const FORTNIGHT_CAP = 90;

export function planDay(input: PlanDayInput): OptResult {
  const {
    targetDate,
    jobs,
    stopsMap,
    drivers,
    warehouses,
    ledger,
    shifts,
    overrides,
    travelHours,
    driverEquipment,
    nowMs,
  } = input;

  const whById: Record<string, Warehouse> = {};
  for (const w of warehouses) whById[w.id] = w;

  // Map domain drivers → optimizer drivers
  const optDrivers: OptDriver[] = [];
  for (const d of [...drivers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const totals = ledger[d.id] ?? { daily: 0, weekly: 0, twoWeek: 0 };
    const compliance = computeCompliance([], nowMs, totals);
    const shift = shifts[d.id];
    const shiftWindow = shiftWindowMs(targetDate, shift, nowMs);

    // Only include drivers who are available today
    if (!isDriverAvailableOnDate(d.id, targetDate, shifts, overrides)) continue;

    // Skip drivers blocked by compliance
    if (compliance.blockAssignment) continue;

    // Start position: use driver GPS or home warehouse
    let lat = d.current_lat ?? 0;
    let lon = d.current_lon ?? 0;
    if (d.home_warehouse_id) {
      const homeWh = whById[d.home_warehouse_id];
      if (homeWh) {
        lat = homeWh.latitude;
        lon = homeWh.longitude;
      }
    }

    // Daily cap adjusted for weekly/fortnight headroom
    let cap = DAILY_CAP;
    if (compliance.weekly >= WEEKLY_CAP - DAILY_CAP)
      cap = Math.min(cap, WEEKLY_CAP - compliance.weekly);
    if (compliance.twoWeek >= FORTNIGHT_CAP - DAILY_CAP)
      cap = Math.min(cap, FORTNIGHT_CAP - compliance.twoWeek);
    if (cap <= 0) continue;

    const equipment = driverEquipment?.[d.id];
    let equipArr: string[] | undefined;
    if (equipment && equipment.size > 0) equipArr = [...equipment].sort();

    optDrivers.push({
      id: d.id,
      lat,
      lon,
      readyMs: shiftWindow.startMs,
      shiftEndMs: shiftWindow.endMs,
      hoursLeft: cap,
      weeklyUsed: compliance.weekly,
      fortnightUsed: compliance.twoWeek,
      homeWarehouseId: d.home_warehouse_id ?? null,
      equipment: equipArr,
    });
  }

  // Map domain jobs → optimizer jobs
  const optJobs: OptJob[] = [];
  for (const j of [...jobs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const stops = stopsMap[j.id];
    if (!stops || stops.length === 0) continue;
    optJobs.push({
      id: j.id,
      stops,
      equipmentType: j.equipment_type ?? null,
    });
  }

  return optimizeRoutes({
    drivers: optDrivers,
    jobs: optJobs,
    warehouses,
    travelHours,
  });
}
