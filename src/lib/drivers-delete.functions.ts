import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";

/**
 * Delete a driver and all their associated data.
 * Authorisation: caller must be a super admin OR a member of the driver's tenant.
 */
export const deleteDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ driverId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: drv, error: fetchErr } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id, tenant_id")
      .eq("id", data.driverId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!drv) return { ok: true };

    if (!(await isSuperAdmin(userId))) {
      const callerTenant = await getUserTenantId(userId);
      if (!callerTenant || callerTenant !== drv.tenant_id) {
        throw new Error("Forbidden");
      }
    }

    // Free up this driver's open jobs so customer work is not orphaned: send
    // anything not finished back to PENDING / unassigned (re-plannable).
    const { error: jobErr } = await supabaseAdmin
      .from("jobs")
      .update({
        status: "PENDING",
        assigned_driver_id: null,
        planned_driver_id: null,
        planned_sequence: null,
        planned_start_at: null,
      } as never)
      .or(`assigned_driver_id.eq.${data.driverId},planned_driver_id.eq.${data.driverId}`)
      .not("status", "in", "(COMPLETED,CANCELLED)");
    if (jobErr) console.error("[deleteDriver] job reset failed", jobErr);

    // Best-effort sweep of driver-owned rows that may not cascade. The FK
    // ON DELETE CASCADE handles shifts/equipment/tacho/events/day_hours, but we
    // clear high-volume telemetry explicitly so nothing lingers.
    for (const table of ["driver_positions", "driver_push_subscriptions"]) {
      const { error } = await (supabaseAdmin as unknown as { from: (t: string) => any })
        .from(table)
        .delete()
        .eq("driver_id", data.driverId);
      if (error) console.warn(`[deleteDriver] sweep ${table} failed`, error.message);
    }

    const { error: delErr } = await supabaseAdmin.from("drivers").delete().eq("id", data.driverId);
    if (delErr) throw new Error(delErr.message);

    if (drv.user_id) {
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(drv.user_id);
      if (authErr) console.error("[deleteDriver] auth user delete failed", authErr);
    }
    return { ok: true };
  });
