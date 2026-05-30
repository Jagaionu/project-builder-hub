/**
 * Core planning logic shared by planJobs server fn and AI agent actions.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computePlanForDate, type StopsMap } from "@/lib/planner";
import { computeCompliance, type ComplianceEvent } from "@/lib/compliance";
import { computeStopSchedule } from "@/lib/geo";
import { fetchShiftsByDriver } from "@/lib/driver-shifts";
import type { Driver, DriverAvailabilityOverride, DriverShift, Warehouse, Job } from "@/lib/types";

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

export async function planJobsForTenant(tenantId: string | null): Promise<PlanJobsResult> {
  const nowMs = Date.now();
  const eventsSince = new Date(nowMs - 14 * 24 * 3600 * 1000).toISOString();

  const jobsQ = supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("status", "PENDING")
    .is("assigned_driver_id", null)
    .is("manual_override", false);

  const stopsQ = supabaseAdmin
    .from("job_stops")
    .select("*, jobs!inner(tenant_id)")
    .order("seq");

  const driversQ = supabaseAdmin.from("drivers").select("*");
  const whQ = supabaseAdmin.from("warehouses").select("*");
  const eventsQ = supabaseAdmin
    .from("driver_events")
    .select("driver_id,type,timestamp")
    .gte("timestamp", eventsSince);

  const [
    { data: jobs },
    { data: drivers },
    { data: warehouses },
    { data: stops },
    { data: events },
    { data: ledger },
  ] = await Promise.all([
    tenantId ? jobsQ.eq("tenant_id", tenantId) : jobsQ,
    tenantId ? driversQ.eq("tenant_id", tenantId) : driversQ,
    tenantId ? whQ.or(`tenant_id.eq.${tenantId},tenant_id.is.null`) : whQ,
    tenantId ? stopsQ.eq("jobs.tenant_id", tenantId) : stopsQ,
    tenantId ? eventsQ.eq("tenant_id", tenantId) : eventsQ,
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
      daily: todayRow ? todayRow.drive_minutes / 60 : undefined,
      weekly: weekRows.length ? weekRows.reduce((s, r) => s + r.drive_minutes, 0) / 60 : undefined,
      twoWeek: fortRows.length ? fortRows.reduce((s, r) => s + r.drive_minutes, 0) / 60 : undefined,
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

  for (const [dateStr, dateJobs] of byDate) {
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

  const assignedIds = new Set(toApply.map((a) => a.id));
  const toClear: string[] = [];

  const { data: stalePlanned } = await (tenantId
    ? supabaseAdmin
        .from("jobs")
        .select("id,status,manual_override,planned_driver_id,planned_sequence,planned_start_at,assigned_driver_id")
        .eq("tenant_id", tenantId)
        .eq("status", "ASSIGNED")
        .is("manual_override", false)
    : supabaseAdmin
        .from("jobs")
        .select("id,status,manual_override,planned_driver_id,planned_sequence,planned_start_at,assigned_driver_id")
        .eq("status", "ASSIGNED")
        .is("manual_override", false));

  for (const j of stalePlanned ?? []) {
    if (!assignedIds.has(j.id as string)) {
      if (!ACTIVE_STATUSES.has(j.status as string)) {
        toClear.push(j.id as string);
      }
    }
  }

  const writes: Array<Promise<unknown>> = [];

  if (toClear.length) {
    writes.push(
      Promise.resolve(
        supabaseAdmin
          .from("jobs")
          .update({
            planned_driver_id: null,
            planned_sequence: null,
            planned_start_at: null,
            assigned_driver_id: null,
            status: "PENDING",
          })
          .in("id", toClear),
      ),
    );
  }

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
    cleared: toClear.length,
    driversPlanned: new Set(toApply.map((a) => a.assigned_driver_id)).size,
  };
}
