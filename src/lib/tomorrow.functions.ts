import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";
import { computeTomorrowPlan, type StopsMap } from "@/lib/planner";
import { computeCompliance, type ComplianceEvent } from "@/lib/compliance";
import type { Driver, Warehouse, Job } from "@/lib/types";

function tomorrowISO() {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

export const planTomorrow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const superAdmin = await isSuperAdmin(userId);
    const tenantId = superAdmin ? null : await getUserTenantId(userId);
    if (!superAdmin && !tenantId) throw new Error("Forbidden");

    const tomorrow = tomorrowISO();
    const jobsQ = supabaseAdmin.from("jobs").select("*").eq("for_date", tomorrow);
    const driversQ = supabaseAdmin.from("drivers").select("*");
    // Include shared (tenant_id IS NULL) warehouses for tenant planning,
    // matching the RLS select policy on warehouses.
    const whQ = tenantId
      ? supabaseAdmin.from("warehouses").select("*").or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      : supabaseAdmin.from("warehouses").select("*");
    const eventsQ = supabaseAdmin.from("driver_events").select("driver_id,type,timestamp");
    const [{ data: jobs }, { data: drivers }, { data: warehouses }, { data: stops }, { data: events }, { data: ledger }] =
      await Promise.all([
        tenantId ? jobsQ.eq("tenant_id", tenantId) : jobsQ,
        tenantId ? driversQ.eq("tenant_id", tenantId) : driversQ,
        whQ,
        supabaseAdmin.from("job_stops").select("*").order("seq"),
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
    });
  }

  // Compliance per driver
  const eventsByDriver: Record<string, ComplianceEvent[]> = {};
  for (const e of events ?? []) {
    (eventsByDriver[e.driver_id as string] ||= []).push({ type: e.type as string, timestamp: e.timestamp as string });
  }
  const ledgerByDriver: Record<string, { day: string; drive_minutes: number }[]> = {};
  for (const r of ledger ?? []) {
    (ledgerByDriver[r.driver_id as string] ||= []).push({ day: r.day as string, drive_minutes: r.drive_minutes as number });
  }
  const compliance: Record<string, ReturnType<typeof computeCompliance>> = {};
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const weekAgo = new Date(now - 6 * 86400_000).toISOString().slice(0, 10);
  const fortnightAgo = new Date(now - 13 * 86400_000).toISOString().slice(0, 10);
  for (const d of driverList) {
    const rows = ledgerByDriver[d.id] ?? [];
    const todayRow = rows.find((r) => r.day === today);
    const weekRows = rows.filter((r) => r.day >= weekAgo && r.day <= today);
    const fortRows = rows.filter((r) => r.day >= fortnightAgo && r.day <= today);
    const totals = {
      daily: todayRow ? todayRow.drive_minutes / 60 : undefined,
      weekly: weekRows.length ? weekRows.reduce((s, r) => s + r.drive_minutes, 0) / 60 : undefined,
      twoWeek: fortRows.length ? fortRows.reduce((s, r) => s + r.drive_minutes, 0) / 60 : undefined,
    };
    compliance[d.id] = computeCompliance(eventsByDriver[d.id] ?? [], now, totals);
  }

  const plan = computeTomorrowPlan(jobList, stopsMap, driverList, whList, compliance);

  // Diagnostics — surface why drivers may not match (visible in server logs)
  const availableDrivers = driverList.filter((d) => (d as { available_tomorrow?: boolean }).available_tomorrow);
  const eligibleDrivers = availableDrivers.filter((d) => {
    const dd = d as Driver & { tomorrow_start_lat?: number | null; tomorrow_start_lon?: number | null };
    const lat = dd.tomorrow_start_lat ?? d.current_lat;
    const lon = dd.tomorrow_start_lon ?? d.current_lon;
    return lat != null && lon != null && !compliance[d.id]?.blockAssignment;
  });
  console.log("[plan-tomorrow] summary", {
    tomorrow,
    tenantId,
    totalJobs: jobList.length,
    totalDrivers: driverList.length,
    availableTomorrow: availableDrivers.length,
    eligibleAfterCompliance: eligibleDrivers.length,
    planned: plan.planned.length,
    unassignable: plan.unassignable.length,
    sampleUnassignable: plan.unassignable.slice(0, 3),
  });

  // Persist planned_* for assigned jobs; clear for unassigned
  const desired = new Map(plan.planned.map((p) => [p.jobId, p] as const));
  for (const j of jobList) {
    const want = desired.get(j.id);
    if (want) {
      await supabaseAdmin
        .from("jobs")
        .update({
          planned_driver_id: want.driverId,
          planned_sequence: want.sequence,
          planned_start_at: want.startAt,
        })
        .eq("id", j.id);
    } else if (j.planned_driver_id || j.planned_sequence || j.planned_start_at) {
      await supabaseAdmin
        .from("jobs")
        .update({ planned_driver_id: null, planned_sequence: null, planned_start_at: null })
        .eq("id", j.id);
    }
  }

  // Drivers see tomorrow's plan in the driver app via Realtime subscriptions.

  return {
    tomorrow,
    totalJobs: jobList.length,
    assigned: plan.planned.length,
    unassignable: plan.unassignable,
    driversPlanned: new Set(plan.planned.map((p) => p.driverId)).size,
  };
});
