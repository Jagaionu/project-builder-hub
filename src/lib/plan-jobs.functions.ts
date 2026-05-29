/**
 * Unified job planner — replaces both "Plan Now" (client-side) and
 * "Plan Tomorrow" (server-side) with a single server function.
 *
 * Strategy:
 *  1. Load ALL pending, unassigned jobs across every date.
 *  2. Group them by for_date.
 *  3. For each date group run computePlanForDate with:
 *       – Calendar-based availability (driver_shifts + driver_availability_overrides).
 *       – No legacy available_tomorrow field — open-policy when no shift record exists.
 *  4. Write assigned_driver_id + status = ASSIGNED for every planned job.
 *  5. Clear stale plan fields from jobs that were previously auto-planned but
 *     are no longer in the new plan (respects manual_override and active jobs).
 */

import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";
import { computePlanForDate, type StopsMap } from "@/lib/planner";
import { computeCompliance, type ComplianceEvent } from "@/lib/compliance";
import type { Driver, DriverAvailabilityOverride, DriverShift, Warehouse, Job } from "@/lib/types";

const ACTIVE_STATUSES = new Set([
  "IN_PROGRESS",
  "ARRIVED_PICKUP",
  "EN_ROUTE_DELIVERY",
  "COMPLETED",
  "CANCELLED",
]);

export const planJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const superAdmin = await isSuperAdmin(userId);
    const tenantId = superAdmin ? null : await getUserTenantId(userId);
    if (!superAdmin && !tenantId) throw new Error("Forbidden");

    const nowMs = Date.now();
    const eventsSince = new Date(nowMs - 14 * 24 * 3600 * 1000).toISOString();

    // ── 1. Load all data in parallel ────────────────────────────────────────
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
      // Include both tenant-specific AND global (tenant_id IS NULL) warehouses.
      tenantId ? whQ.or(`tenant_id.eq.${tenantId},tenant_id.is.null`) : whQ,
      tenantId ? stopsQ.eq("jobs.tenant_id", tenantId) : stopsQ,
      tenantId ? eventsQ.eq("tenant_id", tenantId) : eventsQ,
      supabaseAdmin.from("driver_day_hours").select("*"),
    ]);

    const jobList = (jobs ?? []) as Job[];
    const driverList = (drivers ?? []) as Driver[];
    const whList = (warehouses ?? []) as Warehouse[];

    // ── 2. Build stops map ────────────────────────────────────────────────────
    const stopsMap: StopsMap = {};
    for (const s of stops ?? []) {
      (stopsMap[s.job_id as string] ||= []).push({
        kind: s.kind as "PICKUP" | "DROP",
        warehouse_id: s.warehouse_id as string,
        arrived_at: s.arrived_at as string | null,
        scheduled_at: s.scheduled_at as string | null,
      });
    }

    // ── 3. Compute compliance per driver ──────────────────────────────────────
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

    // ── 4. Load driver calendar data ─────────────────────────────────────────
    const driverIds = driverList.map((d) => d.id);
    let driverShifts: Record<string, DriverShift> = {};
    let allOverrides: DriverAvailabilityOverride[] = [];

    if (driverIds.length > 0) {
      // Collect all unique for_dates from pending jobs so we fetch overrides
      // for exactly the dates we'll be planning — not just tomorrow.
      const targetDates = Array.from(
        new Set(jobList.map((j) => j.for_date).filter((d): d is string => d != null)),
      );

      const [{ data: shifts }, { data: overrides }] = await Promise.all([
        supabaseAdmin.from("driver_shifts").select("*").in("driver_id", driverIds),
        targetDates.length > 0
          ? supabaseAdmin
              .from("driver_availability_overrides")
              .select("*")
              .in("driver_id", driverIds)
              .in("date", targetDates)
          : Promise.resolve({ data: [] }),
      ]);

      driverShifts = Object.fromEntries(
        ((shifts ?? []) as DriverShift[]).map((s) => [s.driver_id, s]),
      );
      allOverrides = (overrides ?? []) as DriverAvailabilityOverride[];
    }

    // ── 5. Group jobs by for_date and plan each group ─────────────────────────
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

    // Jobs with no for_date are unassignable (we can't determine the correct day).
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

    // ── 6. Also handle any previously auto-planned jobs that are no longer in
    //       the new plan (plan was re-run and the assignment changed). ──────────
    //
    // Load ALL auto-planned pending jobs (not just the ones we queried above,
    // since some may have been assigned previously and need clearing if we
    // find a better assignment or if they no longer have eligible drivers).
    const assignedIds = new Set(toApply.map((a) => a.id));
    const toClear: string[] = [];

    // Load currently-planned-but-pending jobs for clearing (separate query
    // so we don't miss jobs that now have assigned_driver_id from a stale plan).
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
        // Was assigned by a previous auto-plan run but not in today's plan.
        // Re-check: only clear if it's not already actively in progress.
        if (!ACTIVE_STATUSES.has(j.status as string)) {
          toClear.push(j.id as string);
        }
      }
    }

    // ── 7. Write to DB ───────────────────────────────────────────────────────
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
    }

    await Promise.all(writes);

    return {
      totalJobs: jobList.length,
      assigned: toApply.length,
      unassignable: allUnassignable,
      cleared: toClear.length,
      driversPlanned: new Set(toApply.map((a) => a.assigned_driver_id)).size,
    };
  });
