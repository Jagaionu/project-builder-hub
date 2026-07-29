// Server-side plan entitlements loader. Reads super-admin-editable definitions
// from plan_definitions; falls back to the code defaults if a row (or the
// table) is missing, so the app keeps working before the migration is run.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { entitlementsForPlan, type PlanEntitlements, type TenantModule } from "./plan-entitlements";
import type { PlanTier } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export async function loadPlanEntitlements(plan: PlanTier): Promise<PlanEntitlements> {
  try {
    const { data } = await sb
      .from("plan_definitions")
      .select("modules, max_seats, max_drivers, max_warehouses, custom_branding")
      .eq("plan", plan)
      .maybeSingle();
    if (data) {
      return {
        modules: (data.modules ?? []) as TenantModule[],
        maxSeats: data.max_seats ?? 0,
        maxDrivers: data.max_drivers ?? 0,
        maxWarehouses: data.max_warehouses ?? 0,
        customBranding: Boolean(data.custom_branding),
      };
    }
  } catch {
    // plan_definitions may not exist yet
  }
  return entitlementsForPlan(plan);
}
