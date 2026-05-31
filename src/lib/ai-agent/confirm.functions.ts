import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId } from "@/lib/auth-helpers.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const confirmInputSchema = z.object({
  action_id: z.string().uuid(),
});

export type ConfirmActionResult = {
  success: true;
  result: any;
};

export const confirmAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => confirmInputSchema.parse(data))
  .handler(async ({ context, data }): Promise<ConfirmActionResult> => {
    const { userId } = context;
    const tenantId = await getUserTenantId(userId);
    if (!tenantId) throw new Error("Forbidden");

    const { data: deleted, error } = await supabaseAdmin
      .from("ai_pending_actions")
      .delete()
      .eq("id", data.action_id)
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .gt("expires_at", new Date().toISOString())
      .select("*");

    if (error || !deleted?.length) {
      throw new Error("Action not found or expired");
    }

    const action = deleted[0];
    const { executeAction } = await import("./actions.server");
    const result = await executeAction(
      action.action_type,
      action.params as Record<string, unknown>,
      tenantId,
      userId,
    );

    return { success: true as const, result };
  });
