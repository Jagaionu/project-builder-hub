/**
 * Unified job planner — server function wrapper around planJobsForTenant.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";

export type { PlanJobsResult } from "@/lib/plan-jobs-core.server";

export const planJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const superAdmin = await isSuperAdmin(userId);
    const tenantId = superAdmin ? null : await getUserTenantId(userId);
    if (!superAdmin && !tenantId) throw new Error("Forbidden");

    const { planJobsForTenant } = await import("@/lib/plan-jobs-core.server");
    return planJobsForTenant(tenantId);
  });
