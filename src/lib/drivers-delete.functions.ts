import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Delete a driver and all their associated data.
 * - Cascade FKs on driver_events / driver_positions / driver_day_hours /
 *   driver_registrations remove related rows automatically.
 * - Jobs with this driver assigned have the reference set to NULL (history preserved).
 * - The matching auth.users row is also removed so we don't leave orphan auth accounts.
 */
export const deleteDriver = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ driverId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: drv, error: fetchErr } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id")
      .eq("id", data.driverId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!drv) return { ok: true };

    const { error: delErr } = await supabaseAdmin
      .from("drivers")
      .delete()
      .eq("id", data.driverId);
    if (delErr) throw new Error(delErr.message);

    if (drv.user_id) {
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(drv.user_id);
      if (authErr) console.error("[deleteDriver] auth user delete failed", authErr);
    }
    return { ok: true };
  });
