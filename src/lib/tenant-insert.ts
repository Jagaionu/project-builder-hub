import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve the current user's tenant (company) id from the DB.
 * Falls back to drivers.user_id for driver-app accounts.
 * Cached per session to avoid repeated round trips.
 */
let cached: { userId: string; tenantId: string } | null = null;

export async function getTenantId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  if (cached && cached.userId === session.user.id) return cached.tenantId;

  // Try company_members first.
  const { data: member } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (member?.company_id) {
    cached = { userId: session.user.id, tenantId: member.company_id };
    return member.company_id;
  }

  // Fallback: driver-app user.
  const { data: driver } = await supabase
    .from("drivers")
    .select("tenant_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (driver?.tenant_id) {
    cached = { userId: session.user.id, tenantId: driver.tenant_id };
    return driver.tenant_id;
  }

  throw new Error("No tenant found for current user");
}

export function clearTenantCache() {
  cached = null;
}
