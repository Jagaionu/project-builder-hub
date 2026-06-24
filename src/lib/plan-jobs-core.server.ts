/**
 * plan-jobs-core.server.ts — Core planning logic.
 *
 * Wire the full regret-2 + local search pipeline:
 *   1. buildHoursLedger (real HGV hours from driver_day_hours)
 *   2. makeTravelHours (real road times from lane_travel_times)
 *   3. planDay (regret-2 insertion + local search)
 *   4. toRoutePersistence (OptResult → routes/route_jobs rows)
 *   5. INSERT routes, then route_jobs linked to routes.id
 *
 * IMPORTANT: NEVER writes planned times back into job_stops.scheduled_at.
 * That was the non-determinism bug that corrupted lane_travel_times data.
 * Timing persists only to routes/route_jobs.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { StopsMap } from "@/lib/planner";
import { computeCompliance, type ComplianceEvent } from "@/lib/compliance";
import { haversineKm } from "@/lib/geo";
import { fetchShiftsByDriver } from "@/lib/driver-shifts";
import { buildHoursLedger } from "@/lib/driver-hours-ledger";
import { recomputeDriverDay } from "@/lib/shift-ledger.server";
import { makeTravelHours } from "@/lib/travel-provider";
import { planDay } from "@/lib/plan-day";
import { toRoutePersistence } from "@/lib/route-persistence";
import type { Driver, DriverAvailabilityOverride, DriverShift, Warehouse, Job } from "@/lib/types";

// Statuses that mean a job is actively being executed by a driver right now.
// These are NEVER reset — you cannot un-assign a driver who is already driving.
const ACTIVE_STATUSES = new Set([
  "IN_PROGRESS",
  "ARRIVED_PICKUP",
  "EN_ROUTE_DELIVERY",
  "COMPLETED",
  "CANCELLED",
]);

export type PlanJobsResult = {
  totalJobs: number;
  assigned: number;
  unassignable: Array<{ jobId: string; reason: string }>;
  cleared: number;
  driversPlanned: number;
  /** Number of deadhead return-to-base legs inserted into route_jobs. */
  rtbLegsAdded: number;
};

export async function planJobsForTenant(tenantId: string | null): Promise<PlanJobsResult> {
  const nowMs = Date.now();
  const eventsSince = new Date(nowMs - 14 * 24 * 3600 * 1000).toISOString();

  // ── STEP 1: Reset all previously auto-planned assignments back to PENDING ──

  let resetQuery = supabaseAdmin
    .from("jobs")
    .update({
      status: "PENDING",
      assigned_driver_id: null,
      planned_driver_id: null,
      planned_sequence: null,
      planned_start_at: null,
    })
    .eq("status", "ASSIGNED")
    .eq("manual_override", false);

  if (tenantId) {
    resetQuery = resetQuery.eq("tenant_id", tenantId);
  }

  const { error: resetError, data: resetIds } = await resetQuery.select("id");
  if (resetError) throw new Error(`Failed to reset assignments: ${resetError.message}`);
  const cleared = (resetIds ?? []).length;

  // ── STEP 2: Load all data ──────────────────────────────────────────────────

  let jobsQ = supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("status", "PENDING")
    .is("assigned_driver_id", null)
    .order("id", { ascending: true });

  let stopsQ = supabaseAdmin
    .from("job_stops")
    .select("*, jobs!inner(tenant_id)")
    .order("seq", { ascending: true });

  let driversQ = supabaseAdmin.from("drivers").select("*").order("id", { ascending: true });

  let whQ = supabaseAdmin.from("warehouses").select("*").order("id", { ascending: true });

  let eventsQ = supabaseAdmin
    .from("driver_events")
    .select("driver_id,type,timestamp")
    .gte("timestamp", eventsSince)
    .order("timestamp", { ascending: true });

  if (tenantId) {
    jobsQ = jobsQ.eq("tenant_id", tenantId);
    driversQ = driversQ.eq("tenant_id", tenantId);
    whQ = whQ.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
    stopsQ = stopsQ.eq("jobs.tenant_id", tenantId);
    eventsQ = eventsQ.eq("tenant_id", tenantId);
  }

  const [
    { data: jobs },
    { data: drivers },
    { data: warehouses },
    { data: stops },
    { data: events },
    { data: equipRows },
    { data: lanes },
  ] = await Promise.all([
    jobsQ,
    driversQ,
    whQ,
    stopsQ,
    eventsQ,
    (supabaseAdmin as unknown as { from: (t: string) => any })
      .from("driver_equipment")
      .select("driver_id,equipment_type"),
    (supabaseAdmin as unknown as { from: (t: string) => any })
      .from("lane_travel_times")
      .select(
        "from_warehouse_id,to_warehouse_id,day_of_week,hour_of_day,p50_duration_minutes,avg_duration_minutes,p90_duration_minutes,recent_p50_duration_minutes,recent_sample_count",
      )
      .limit(50000),
  ]);

  const jobList = (jobs ?? []) as Job[];
  const driverList = (drivers ?? []) as Driver[];
  const whList = (warehouses ?? []) as Warehouse[];

  // Exclude suspended drivers (suspended with no end date, or whose suspension
  // has not yet expired) — they must not receive planned work.
  const activeDriverList = driverList.filter((d) => {
    const s = d as unknown as { suspended?: boolean | null; suspended_until?: string | null };
    return !(
      s.suspended &&
      (!s.suspended_until || new Date(s.suspended_until).getTime() > nowMs)
    );
  });

  const stopsMap: StopsMap = {};
  for (const s of stops ?? []) {
    (stopsMap[s.job_id as string] ||= []).push({
      kind: s.kind as "PICKUP" | "DROP",
      warehouse_id: s.warehouse_id as string,
      arrived_at: s.arrived_at as string | null,
      scheduled_at: s.scheduled_at as string | null,
    });
  }

  // Build driver equipment capability map.
  const driverEquipment: Record<string, Set<string>> = {};
  for (const row of (equipRows ?? []) as unknown as {
    driver_id: string;
    equipment_type: string;
  }[]) {
    (driverEquipment[row.driver_id] ||= new Set()).add(row.equipment_type);
  }

  // Build real travel function from lane_travel_times.
  const travelHoursFn = makeTravelHours((lanes ?? []) as any[]);

  const driverIds = activeDriverList.map((d) => d.id);
  let driverShifts: Record<string, DriverShift> = {};
  let allOverrides: DriverAvailabilityOverride[] = [];

  if (driverIds.length > 0) {
    const targetDates = Array.from(
      new Set(jobList.map((j) => j.for_date).filter((d): d is string => d != null)),
    );

    const [shiftsByDriver, { data: overrides }] = await Promise.all([
      fetchShiftsByDriver(supabaseAdmin, driverIds),
      targetDates.length > 0
        ? supabaseAdmin
            .from("driver_availability_overrides")
            .select("*")
            .in("driver_id", driverIds)
            .in("date", targetDates)
        : Promise.resolve({ data: [] }),
    ]);

    driverShifts = shiftsByDriver;
    allOverrides = (overrides ?? []) as DriverAvailabilityOverride[];
  }

  // ── STEP 3: Build hours ledger (real HGV hours) ────────────────────────────
  const ledger = await buildHoursLedger(
    supabaseAdmin as unknown as { from: (t: string) => any },
    driverIds,
    nowMs,
  );

  // ── STEP 4: Group jobs by date and run the optimizer (planDay) ─────────────

  const byDate = new Map<string, Job[]>();
  const noDate: Job[] = [];

  for (const job of jobList) {
    if (job.for_date) {
      const bucket = byDate.get(job.for_date) ?? [];
      bucket.push(job);
      byDate.set(job.for_date, bucket);
    } else {
      noDate.push(job);
    }
  }

  const allUnassignable: Array<{ jobId: string; reason: string }> = noDate.map((j) => ({
    jobId: j.id,
    reason: "No for_date set — cannot determine service day",
  }));

  const toApply: Array<{
    id: string;
    planned_driver_id: string;
    planned_sequence: number;
    planned_start_at: string;
    assigned_driver_id: string;
    status: "ASSIGNED";
  }> = [];
  const refreshPairs = new Set<string>();

  const sortedDates = Array.from(byDate.keys()).sort();
  let rtbLegsAdded = 0;

  for (const dateStr of sortedDates) {
    const dateJobs = byDate.get(dateStr)!;

    // Run the full regret-2 + local search optimizer.
    const result = planDay({
      targetDate: dateStr,
      jobs: dateJobs,
      stopsMap,
      drivers: activeDriverList,
      warehouses: whList,
      ledger,
      shifts: driverShifts,
      overrides: allOverrides,
      travelHours: travelHoursFn,
      driverEquipment,
      nowMs,
    });

    // Map assignments to job updates.
    for (const a of result.assignments) {
      toApply.push({
        id: a.jobId,
        planned_driver_id: a.driverId,
        planned_sequence: a.sequence,
        planned_start_at: a.startAt,
        assigned_driver_id: a.driverId,
        status: "ASSIGNED",
      });
      refreshPairs.add(a.driverId + "|" + dateStr);
    }
    allUnassignable.push(...result.uncovered.map((u) => ({ jobId: u.jobId, reason: u.reason })));

    // ── Persist routes and route_jobs ────────────────────────────────────────
    const plannerRunId = crypto.randomUUID();
    const persistedRoutes = toRoutePersistence(result, {
      tenantId: tenantId ?? undefined,
      routeDate: dateStr,
      plannerRunId,
    });

    const sbAny = supabaseAdmin as unknown as { from: (t: string) => any };

    for (const pr of persistedRoutes) {
      const { data: routeRow } = await sbAny.from("routes").insert(pr.route).select("id").single();

      if (routeRow?.id) {
        await sbAny
          .from("route_jobs")
          .insert(pr.jobs.map((j) => ({ ...j, route_id: routeRow.id })));
        if (pr.route.ends_at_home) rtbLegsAdded++;
      }
    }
  }

  // ── STEP 5: Write job assignments (NEVER write to job_stops.scheduled_at) ──

  const writes: Array<Promise<unknown>> = [];

  for (const u of toApply) {
    const { id, ...patch } = u;
    writes.push(Promise.resolve(supabaseAdmin.from("jobs").update(patch).eq("id", id)));
  }

  await Promise.all(writes);

  // Refresh planned drive_minutes for each (driver, day) so compliance caps are
  // current immediately after planning (not stale until the nightly rollover).
  for (const key of refreshPairs) {
    const [did, day] = key.split("|");
    try {
      await recomputeDriverDay(did, day);
    } catch (e) {
      console.warn("[plan] hours refresh failed", did, day, e);
    }
  }

  return {
    totalJobs: jobList.length,
    assigned: toApply.length,
    unassignable: allUnassignable,
    cleared: cleared ?? 0,
    driversPlanned: new Set(toApply.map((a) => a.assigned_driver_id)).size,
    rtbLegsAdded,
  };
}
