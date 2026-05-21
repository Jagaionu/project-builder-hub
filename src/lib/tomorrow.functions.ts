import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeTomorrowPlan, type StopsMap } from "@/lib/planner";
import { computeCompliance, type ComplianceEvent } from "@/lib/compliance";
import type { Driver, Warehouse, Job } from "@/lib/types";

function tomorrowISO() {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

export const planTomorrow = createServerFn({ method: "POST" }).handler(async () => {
  const tomorrow = tomorrowISO();
  const [{ data: jobs }, { data: drivers }, { data: warehouses }, { data: stops }, { data: events }, { data: ledger }] =
    await Promise.all([
      supabaseAdmin.from("jobs").select("*").eq("for_date", tomorrow),
      supabaseAdmin.from("drivers").select("*"),
      supabaseAdmin.from("warehouses").select("*"),
      supabaseAdmin.from("job_stops").select("*").order("seq"),
      supabaseAdmin.from("driver_events").select("driver_id,type,timestamp"),
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
  for (const d of driverList) {
    compliance[d.id] = computeCompliance(eventsByDriver[d.id] ?? [], now, ledgerByDriver[d.id] ?? []);
  }

  const plan = computeTomorrowPlan(jobList, stopsMap, driverList, whList, compliance);

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

  // Notify each driver who got jobs
  const driverIds = Array.from(new Set(plan.planned.map((p) => p.driverId)));
  const { notifyDriverTomorrowRoutes } = await import("@/lib/telegram-notify.functions");
  for (const did of driverIds) {
    try {
      await notifyDriverTomorrowRoutes({ data: { driverId: did } });
    } catch (err) {
      console.error("notify tomorrow failed", did, err);
    }
  }

  return {
    tomorrow,
    totalJobs: jobList.length,
    assigned: plan.planned.length,
    unassignable: plan.unassignable,
    driversNotified: driverIds.length,
  };
});
