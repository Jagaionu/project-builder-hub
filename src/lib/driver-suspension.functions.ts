import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";

/**
 * Suspend or un-suspend a driver. A suspended driver is blocked from the
 * driver app and excluded from planning.
 * Authorisation: super admin OR a member of the driver's tenant.
 */
export const setDriverSuspension = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        driverId: z.string().uuid(),
        suspended: z.boolean(),
        // ISO timestamp the suspension lasts until. null/undefined = indefinite.
        until: z.string().datetime().nullable().optional(),
        reason: z.string().max(500).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: drv, error: fetchErr } = await supabaseAdmin
      .from("drivers")
      .select("id, tenant_id")
      .eq("id", data.driverId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!drv) throw new Error("Driver not found");

    if (!(await isSuperAdmin(userId))) {
      const callerTenant = await getUserTenantId(userId);
      if (!callerTenant || callerTenant !== drv.tenant_id) {
        throw new Error("Forbidden");
      }
    }

    const patch = data.suspended
      ? {
          suspended: true,
          suspended_until: data.until ?? null,
          suspended_reason: data.reason ?? null,
          suspended_at: new Date().toISOString(),
        }
      : {
          suspended: false,
          suspended_until: null,
          suspended_reason: null,
          suspended_at: null,
        };

    const { error: updErr } = await supabaseAdmin
      .from("drivers")
      .update(patch as never)
      .eq("id", data.driverId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true };
  });
