/**
 * Server-side driver assignment — mirrors dispatch board assignDriver logic.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeCompliance, type ComplianceEvent } from "@/lib/compliance";

async function loadDriverCompliance(driverId: string, tenantId: string) {
  const nowMs = Date.now();
  const eventsSince = new Date(nowMs - 14 * 24 * 3600 * 1000).toISOString();
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const weekAgo = new Date(nowMs - 6 * 86400_000).toISOString().slice(0, 10);
  const fortnightAgo = new Date(nowMs - 13 * 86400_000).toISOString().slice(0, 10);

  const [{ data: events }, { data: ledger }] = await Promise.all([
    supabaseAdmin
      .from("driver_events")
      .select("type,timestamp")
      .eq("driver_id", driverId)
      .eq("tenant_id", tenantId)
      .gte("timestamp", eventsSince),
    supabaseAdmin.from("driver_day_hours").select("day,drive_minutes").eq("driver_id", driverId),
  ]);

  const complianceEvents: ComplianceEvent[] = (events ?? []).map((e) => ({
    type: e.type as string,
    timestamp: e.timestamp as string,
  }));
  const rows = ledger ?? [];
  const todayRow = rows.find((r) => r.day === today);
  const weekRows = rows.filter((r) => r.day >= weekAgo && r.day <= today);
  const fortRows = rows.filter((r) => r.day >= fortnightAgo && r.day <= today);

  return computeCompliance(complianceEvents, nowMs, {
    daily: todayRow ? (todayRow.drive_minutes as number) / 60 : undefined,
    weekly: weekRows.length
      ? weekRows.reduce((s, r) => s + (r.drive_minutes as number), 0) / 60
      : undefined,
    twoWeek: fortRows.length
      ? fortRows.reduce((s, r) => s + (r.drive_minutes as number), 0) / 60
      : undefined,
  });
}

export async function assignDriverToJob(
  jobId: string,
  driverId: string,
  opts: { manual?: boolean; userId: string; tenantId: string },
): Promise<{ success: true; jobId: string; driverId: string }> {
  const { tenantId } = opts;

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("jobs")
    .select("id, tenant_id, assigned_driver_id, status")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (jobErr || !job) throw new Error("Job not found");

  const { data: driver, error: driverErr } = await supabaseAdmin
    .from("drivers")
    .select("id, tenant_id")
    .eq("id", driverId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (driverErr || !driver) throw new Error("Driver not found");

  const compliance = await loadDriverCompliance(driverId, tenantId);
  if (compliance.blockAssignment) {
    const reason = compliance.issues.find((i) => i.level === "breach")?.msg ?? "compliance breach";
    throw new Error(`Cannot assign: ${reason}`);
  }

  const payload = {
    assigned_driver_id: driverId,
    status: "ASSIGNED" as const,
    ...(opts.manual ? { manual_override: true } : {}),
  };

  const { error: updateErr } = await supabaseAdmin.from("jobs").update(payload).eq("id", jobId);
  if (updateErr) throw new Error(updateErr.message);

  await supabaseAdmin.from("drivers").update({ status: "ON_ROUTE" }).eq("id", driverId);

  await (supabaseAdmin as any).from("driver_events").insert({
    driver_id: driverId,
    type: "JOB_ASSIGNED",
    payload: { job_id: jobId, manual: opts.manual ?? false, source: "ai_agent" },
    tenant_id: tenantId,
  });

  const prevDriverId = job.assigned_driver_id as string | null;
  if (prevDriverId && prevDriverId !== driverId) {
    await supabaseAdmin
      .from("drivers")
      .update({ status: "AVAILABLE" })
      .eq("id", prevDriverId)
      .eq("status", "ON_ROUTE");
  }

  return { success: true, jobId, driverId };
}
