import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";

/**
 * Driver submits a profile photo for review. The file is already uploaded to
 * the `avatars` bucket by the client; here we record it as PENDING. A driver
 * can never set the approved photo directly (DB trigger + this fn only ever
 * writes 'pending').
 */
export const submitDriverAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { data: drv, error: fErr } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (!drv) throw new Error("No driver linked to this account");

    const { error } = await supabaseAdmin
      .from("drivers")
      .update({
        pending_avatar_url: data.url,
        avatar_status: "pending",
        avatar_reviewed_at: null,
      } as never)
      .eq("id", drv.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Dispatcher / admin approves or rejects a driver's pending photo.
 * Approve → the pending photo becomes the live avatar. Reject → cleared.
 */
export const reviewDriverAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ driverId: z.string().uuid(), approve: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { userId } = context;
    // Cast past the (stale) generated types that don't yet include the avatar columns.
    const sb = supabaseAdmin as unknown as { from: (t: string) => any };
    const { data: drv, error: fErr } = await sb
      .from("drivers")
      .select("id, tenant_id, pending_avatar_url")
      .eq("id", data.driverId)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (!drv) throw new Error("Driver not found");

    if (!(await isSuperAdmin(userId))) {
      const callerTenant = await getUserTenantId(userId);
      if (!callerTenant || callerTenant !== (drv as { tenant_id: string }).tenant_id) {
        throw new Error("Forbidden");
      }
    }

    const pending = (drv as { pending_avatar_url: string | null }).pending_avatar_url;
    const patch = data.approve
      ? {
          avatar_url: pending,
          pending_avatar_url: null,
          avatar_status: "approved",
          avatar_reviewed_at: new Date().toISOString(),
        }
      : {
          pending_avatar_url: null,
          avatar_status: "rejected",
          avatar_reviewed_at: new Date().toISOString(),
        };

    const { error } = await supabaseAdmin
      .from("drivers")
      .update(patch as never)
      .eq("id", data.driverId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
