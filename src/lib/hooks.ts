import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";

async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000));
    const { data } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("login_code", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("Failed to allocate unique code");
}

/**
 * Rotate a driver's permanent login code. Caller must be a super admin
 * or a member of the driver's tenant.
 */
export const rotateDriverLoginCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ driverId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: drv } = await supabaseAdmin
      .from("drivers")
      .select("tenant_id")
      .eq("id", data.driverId)
      .maybeSingle();
    if (!drv) throw new Error("Driver not found");

    if (!(await isSuperAdmin(userId))) {
      const callerTenant = await getUserTenantId(userId);
      if (!callerTenant || callerTenant !== drv.tenant_id) {
        throw new Error("Forbidden");
      }
    }

    const code = await generateUniqueCode();
    const { error } = await supabaseAdmin
      .from("drivers")
      .update({ login_code: code } as never)
      .eq("id", data.driverId);
    if (error) throw new Error(error.message);
    return { code };
  });

// Backwards-compat alias.
export const generateDriverPairingCode = rotateDriverLoginCode;

/**
 * Returns the current permanent login codes for drivers in the caller's tenant.
 * Super admins see all.
 */
export const getActiveDriverPairingCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const superAdmin = await isSuperAdmin(userId);

    let query = supabaseAdmin.from("drivers").select("id, login_code, tenant_id");
    if (!superAdmin) {
      const tenantId = await getUserTenantId(userId);
      if (!tenantId) return [];
      query = query.eq("tenant_id", tenantId);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((d) => d.login_code)
      .map((d) => ({ driver_id: d.id as string, code: d.login_code as string, expires_at: null as string | null }));
  });
