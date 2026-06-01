/**
 * Core planning logic shared by planJobs server fn and AI agent actions.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computePlanForDate, type StopsMap } from "@/lib/planner";
import { computeCompliance, type ComplianceEvent } from "@/lib/compliance";
import { computeStopSchedule, haversineKm } from "@/lib/geo";
import { fetchShiftsByDriver } from "@/lib/driver-shifts";
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

// Helper: Calculate urgency score (lower = more urgent).
// Uses the job's first pickup warehouse coordinates for the proximity factor.
function urgencyScore(
  job: Job,
  firstPickupLat: number,
  firstPickupLon: number,
  driverList: Driver[],
  nowMs: number,
): number {
  const scheduled = job.scheduled_at ? new Date(job.scheduled_at).getTime() : Infinity;
  const timeUntil = scheduled - nowMs;

  // Find nearest driver distance to this job's first pickup
  const distances = driverList
    .filter(d => d.current_lat != null && d.current_lon != null)
    .map(d => haversineKm(firstPickupLat, firstPickupLon, d.current_lat!, d.current_lon!));

  const minDist = distances.length > 0 ? Math.min(...distances) : 50;

  // Composite: 70% time sensitivity, 30% proximity
  const timeFactor = Math.max(0, Math.min(1, timeUntil / (2 * 3600_000))); // 2h window
  const distFactor = Math.min(1, minDist / 50); // 50km = "far"

  return (timeFactor * 0.7) + (distFactor * 0.3);
}

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

  // ── STEP 2: Load all data (jobs, drivers, warehouses, compliance) ──────────

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

  let driversQ = supabaseAdmin
    .from("drivers")
    .select("*")
    .order("id", { ascending: true });

  let whQ = supabaseAdmin
    .from("warehouses")
    .select("*")
    .order("id", { ascending: true });

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
    { data: ledger },
  ] = await Promise.all([
    jobsQ,
    driversQ,
    whQ,
    stopsQ,
    eventsQ,
    supabaseAdmin.from("driver_day_hours").select("*"),
  ]);

  const jobList = (jobs ?? []) as Job[];
  const driverList = (drivers ?? []) as Driver[];
  const whList = (warehouses ?? []) as Warehouse[];

  const stopsMap: StopsMap = {};
  for (const s of stops ?? []) {
    (stopsMap[s.job_id as string] ||= []).push({
      kind: s.kind as "PICKUP" | "DROP",
      warehouse_id: s.warehouse_id as string,
      arrived_at: s.arrived_at as string | null,
      scheduled_at: s.scheduled_at as string | null,
    });
  }

  const eventsByDriver: Record<string, ComplianceEvent[]> = {};
  for (const e of events ?? []) {
    (eventsByDriver[e.driver_id as string] ||= []).push({
      type: e.type as string,
      timestamp: e.timestamp as string,
    });
  }

  const ledgerByDriver: Record<string, { day: string; drive_minutes: number }[]> = {};
  for (const r of ledger ?? []) {
    (ledgerByDriver[r.driver_id as string] ||= []).push({
      day: r.day as string,
      drive_minutes: r.drive_minutes as number,
    });
  }

  const today = new Date(nowMs).toISOString().slice(0, 10);
  const weekAgo = new Date(nowMs - 6 * 86400_000).toISOString().slice(0, 10);
  const fortnightAgo = new Date(nowMs - 13 * 86400_000).toISOString().slice(0, 10);
  
  const compliance: Record<string, ReturnType<typeof computeCompliance>> = {};
  for (const d of driverList) {
    const rows = ledgerByDriver[d.id] ?? [];
    const todayRow = rows.find((r) => r.day === today);
    const weekRows = rows.filter((r) => r.day >= weekAgo && r.day <= today);
    const fortRows = rows.filter((r) => r.day >= fortnightAgo && r.day <= today);
    
    compliance[d.id] = computeCompliance(eventsByDriver[d.id] ?? [], nowMs, {
      daily: todayRow ? todayRow.drive_minutes / 60 : 0,
      weekly: weekRows.length ? weekRows.reduce((s, r) => s + r.drive_minutes, 0) / 60 : 0,
      twoWeek: fortRows.length ? fortRows.reduce((s, r) => s + r.drive_minutes, 0) / 60 : 0,
    });
  }

  const driverIds = driverList.map((d) => d.id);
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

  // ── STEP 3: Group jobs by date and run the planner ────────────────────────

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

  const sortedDates = Array.from(byDate.keys()).sort();

  for (const dateStr of sortedDates) {
    const dateJobs = byDate.get(dateStr)!;
    
    // ENHANCEMENT: Sort jobs by Urgency Score (Proximity + Time Sensitivity).
    // Build a lookup of first-pickup coordinates from stopsMap + warehouses.
    const jobPickupLoc = new Map<string, { lat: number; lon: number }>();
    for (const job of dateJobs) {
      const stops = stopsMap[job.id] ?? [];
      const fp = stops.find(s => s.kind === "PICKUP") ?? stops[0];
      if (!fp) continue;
      const wh = whList.find(w => w.id === fp.warehouse_id);
      if (wh) jobPickupLoc.set(job.id, { lat: wh.latitude, lon: wh.longitude });
    }

    dateJobs.sort((a, b) => {
      const locA = jobPickupLoc.get(a.id);
      const locB = jobPickupLoc.get(b.id);
      const scoreA = urgencyScore(a, locA?.lat ?? 0, locA?.lon ?? 0, driverList, nowMs);
      const scoreB = urgencyScore(b, locB?.lat ?? 0, locB?.lon ?? 0, driverList, nowMs);
      return scoreA - scoreB || a.id.localeCompare(b.id);
    });

    const result = computePlanForDate(
      dateStr,
      dateJobs,
      stopsMap,
      driverList,
      whList,
      compliance,
      driverShifts,
      allOverrides,
      nowMs,
    );

    for (const p of result.planned) {
      toApply.push({
        id: p.jobId,
        planned_driver_id: p.driverId,
        planned_sequence: p.sequence,
        planned_start_at: p.startAt,
        assigned_driver_id: p.driverId,
        status: "ASSIGNED",
      });
    }
    allUnassignable.push(...result.unassignable);
  }

  // ── STEP 3.5: Return-to-base enforcement ─────────────────────────────────
  //
  // For every driver with return_to_base_required = true, check whether their
  // last planned job on each date terminates at their home_warehouse_id.
  // If not, insert a deadhead route_job leg (and an enclosing routes row if
  // one doesn't already exist) so the driver's day ends at base.
  //
  // Travel time: prefer lane_travel_times avg for that warehouse pair,
  // day-of-week, and estimated departure hour. Falls back to haversine / 60
  // km/h when no historical lane data is available.

  let rtbLegsAdded = 0;

  const rtbDriverIds = new Set(
    driverList
      .filter((d) => d.return_to_base_required && d.home_warehouse_id)
      .map((d) => d.id),
  );

  if (rtbDriverIds.size > 0) {
    // Build: key `${driverId}:${dateStr}` → highest-sequence planned entry for that driver/day.
    const lastEntryByKey = new Map<string, (typeof toApply)[0] & { forDate: string }>();

    for (const p of toApply) {
      if (!rtbDriverIds.has(p.assigned_driver_id)) continue;
      const job = jobList.find((j) => j.id === p.id);
      if (!job?.for_date) continue;
      const key = `${p.assigned_driver_id}:${job.for_date}`;
      const prev = lastEntryByKey.get(key);
      if (!prev || p.planned_sequence > prev.planned_sequence) {
        lastEntryByKey.set(key, { ...p, forDate: job.for_date });
      }
    }

    for (const [key, entry] of lastEntryByKey) {
      const colonIdx = key.indexOf(":");
      const driverId = key.slice(0, colonIdx);
      const dateStr = entry.forDate;

      const driver = driverList.find((d) => d.id === driverId);
      if (!driver?.home_warehouse_id) continue;

      // Resolve the last warehouse this driver will be at on this date.
      // Prefer the last DROP stop from stopsMap; fall back to job.destination_warehouse_id.
      const stops = stopsMap[entry.id] ?? [];
      const lastDrop = [...stops].reverse().find((s) => s.kind === "DROP");
      const lastJob = jobList.find((j) => j.id === entry.id);
      const lastWarehouseId = lastDrop?.warehouse_id ?? lastJob?.destination_warehouse_id ?? null;

      if (!lastWarehouseId || lastWarehouseId === driver.home_warehouse_id) continue;

      const fromWh = whList.find((w) => w.id === lastWarehouseId);
      const toWh = whList.find((w) => w.id === driver.home_warehouse_id);
      if (!fromWh || !toWh) continue;

      const deadheadKm = haversineKm(
        fromWh.latitude, fromWh.longitude,
        toWh.latitude, toWh.longitude,
      );

      // Estimate departure time: planned_start_at + 2 h job duration (conservative).
      // Use 18:00 UTC as absolute fallback for dateless estimates.
      const deptMs = entry.planned_start_at
        ? new Date(entry.planned_start_at).getTime() + 2 * 3_600_000
        : new Date(`${dateStr}T18:00:00Z`).getTime();

      const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getDay();
      const hourOfDay = new Date(deptMs).getUTCHours();

      const sbAny = supabaseAdmin as unknown as { from: (t: string) => any };
      const { data: laneRow } = await sbAny
        .from("lane_travel_times")
        .select("avg_duration_minutes")
        .eq("from_warehouse_id", lastWarehouseId)
        .eq("to_warehouse_id", driver.home_warehouse_id)
        .eq("day_of_week", dayOfWeek)
        .eq("hour_of_day", hourOfDay)
        .order("sample_count", { ascending: false })
        .limit(1)
        .maybeSingle();

      // 60 km/h average speed fallback when no lane telemetry exists yet.
      const deadheadMinutes =
        laneRow?.avg_duration_minutes ?? Math.round((deadheadKm / 60) * 60);

      const effectiveTenantId = tenantId ?? driver.tenant_id ?? null;

      // Find or create the routes row for this driver/date.
      let routeId: string | null = null;
      const { data: existingRoute } = await sbAny
        .from("routes")
        .select("id")
        .eq("driver_id", driverId)
        .eq("route_date", dateStr)
        .limit(1)
        .maybeSingle();

      if (existingRoute?.id) {
        routeId = existingRoute.id;
      } else {
        const { data: newRoute } = await sbAny
          .from("routes")
          .insert({
            tenant_id: effectiveTenantId,
            driver_id: driverId,
            route_date: dateStr,
            status: "planned",
          })
          .select("id")
          .single();
        routeId = newRoute?.id ?? null;
      }

      if (!routeId) continue;

      // Determine the next stop_sequence for this route.
      const { data: seqRow } = await sbAny
        .from("route_jobs")
        .select("stop_sequence")
        .eq("route_id", routeId)
        .order("stop_sequence", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextSeq = (seqRow?.stop_sequence ?? 0) + 1;
      const arrivalIso = new Date(deptMs + deadheadMinutes * 60_000).toISOString();

      const { error: rjError } = await sbAny.from("route_jobs").insert({
        route_id: routeId,
        job_id: null,
        stop_sequence: nextSeq,
        is_deadhead: true,
        deadhead_from_warehouse_id: lastWarehouseId,
        deadhead_to_warehouse_id: driver.home_warehouse_id,
        deadhead_km: deadheadKm,
        deadhead_minutes: deadheadMinutes,
        planned_arrival: arrivalIso,
        planned_departure: arrivalIso,
        tenant_id: effectiveTenantId,
      });

      if (rjError) {
        console.error(`[RTB] Failed to insert deadhead leg for driver ${driverId} on ${dateStr}:`, rjError.message);
        continue;
      }

      // Mark the route as confirmed ending at home.
      await sbAny
        .from("routes")
        .update({ ends_at_home: true })
        .eq("id", routeId);

      rtbLegsAdded++;
    }
  }

  // ── STEP 4: Write all assignments ─────────────────────────────────────────

  const writes: Array<Promise<unknown>> = [];

  for (const u of toApply) {
    const { id, ...patch } = u;
    writes.push(Promise.resolve(supabaseAdmin.from("jobs").update(patch).eq("id", id)));

    const jobStops = stopsMap[id] ?? [];
    if (jobStops.length > 0 && patch.planned_start_at) {
      const times = computeStopSchedule(jobStops, patch.planned_start_at, whList);
      for (let i = 0; i < jobStops.length; i++) {
        const t = times[i];
        if (!t) continue;
        writes.push(
          Promise.resolve(
            supabaseAdmin
              .from("job_stops")
              .update({ scheduled_at: t })
              .eq("job_id", id)
              .eq("seq", i + 1),
          ),
        );
      }
    }
  }

  await Promise.all(writes);

  return {
    totalJobs: jobList.length,
    assigned: toApply.length,
    unassignable: allUnassignable,
    cleared: cleared ?? 0,
    driversPlanned: new Set(toApply.map((a) => a.assigned_driver_id)).size,
    rtbLegsAdded,
  };
}
