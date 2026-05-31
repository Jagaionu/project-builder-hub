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
  };
}
