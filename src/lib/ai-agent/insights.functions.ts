import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as unknown as { from: (t: string) => any };

async function assertSuperAdmin(userId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Forbidden: super admin only");
}

// Permanently delete AI query-log rows by id (used to resolve/clear gaps from
// the AI Insights tab). ai_query_logs has no client DELETE grant, so this runs
// with the service role and is gated to super admins.
export const deleteAiQueryLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(5000) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ deleted: number }> => {
    await assertSuperAdmin(context.userId);
    const { error } = await sb.from("ai_query_logs").delete().in("id", data.ids);
    if (error) throw new Error(error.message);
    return { deleted: data.ids.length };
  });
