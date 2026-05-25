import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Resolve the tenant (company_id) for an authenticated user.
 * Returns null if the user belongs to no tenant.
 */
export async function getUserTenantId(userId: string): Promise<string | null> {
  const { data: member } = await supabaseAdmin
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (member?.company_id) return member.company_id as string;

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (driver?.tenant_id as string | null) ?? null;
}

export async function isSuperAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export async function isCompanyAdmin(userId: string, tenantId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("role")
    .eq("user_id", userId)
    .eq("company_id", tenantId)
    .maybeSingle();
  return data?.role === "admin";
}

/**
 * Confirm the authenticated user can act on the given driver — either
 * they are the driver themselves, a member of the driver's tenant, or a
 * super admin. Throws on failure.
 */
export async function assertDriverAccess(userId: string, driverId: string): Promise<void> {
  if (await isSuperAdmin(userId)) return;
  const { data: drv } = await supabaseAdmin
    .from("drivers")
    .select("user_id, tenant_id")
    .eq("id", driverId)
    .maybeSingle();
  if (!drv) throw new Error("Driver not found");
  if (drv.user_id === userId) return;
  const tenantId = await getUserTenantId(userId);
  if (tenantId && drv.tenant_id === tenantId) return;
  throw new Error("Forbidden");
}
