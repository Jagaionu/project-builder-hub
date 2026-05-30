import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { planJobsForTenant } from "@/lib/plan-jobs-core.server";
import { assignDriverToJob } from "@/lib/assign-driver.server";
import { isCompanyAdmin } from "@/lib/auth-helpers.server";

async function resolveJobId(tenantId: string, reference: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("jobs")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("reference", reference)
    .maybeSingle();
  return data?.id ?? null;
}

async function resolveDriverId(tenantId: string, nameOrId: string): Promise<string | null> {
  const uuidRe = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (uuidRe.test(nameOrId)) {
    const { data } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", nameOrId)
      .maybeSingle();
    if (data) return data.id;
  }

  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", `%${nameOrId}%`)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function executeAction(
  actionType: string,
  params: Record<string, unknown>,
  tenantId: string,
  userId: string,
) {
  const isAdmin = await isCompanyAdmin(userId, tenantId);
  if (!isAdmin && (actionType === "run_plan" || actionType === "assign_driver")) {
    throw new Error("Only company admins can run plans or assign drivers.");
  }

  switch (actionType) {
    case "run_plan": {
      const result = await planJobsForTenant(tenantId);
      return {
        totalJobs: result.totalJobs,
        assigned: result.assigned,
        unassignable: result.unassignable.length,
        cleared: result.cleared,
        driversPlanned: result.driversPlanned,
      };
    }
    case "assign_driver": {
      const jobReference = String(params.job_reference ?? "");
      const driverName = String(params.driver_name ?? "");
      if (!jobReference || !driverName) {
        throw new Error("job_reference and driver_name are required");
      }

      const jobId = await resolveJobId(tenantId, jobReference);
      if (!jobId) throw new Error(`Job not found: ${jobReference}`);

      const driverId = await resolveDriverId(tenantId, driverName);
      if (!driverId) throw new Error(`Driver not found: ${driverName}`);

      return assignDriverToJob(jobId, driverId, { manual: true, userId, tenantId });
    }
    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}
