// Super-admin trial-fee config server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadTrialConfig, saveTrialConfig } from "./trial-config.server";
import type { TrialConfig } from "./trial-config";
import { recordAudit } from "@/lib/security/audit.server";

async function assertSuperAdmin(userId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Forbidden: super admin only");
}

export const getTrialConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    return await loadTrialConfig();
  });

export const updateTrialConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        trial7FeeMinor: z.number().int().min(0).optional(),
        trial14FeeMinor: z.number().int().min(0).optional(),
        defaultTrialDays: z.number().int().min(1).max(60).optional(),
        paidTrialEnabled: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    await saveTrialConfig(data as Partial<TrialConfig>);
    await recordAudit({ actorUserId: context.userId, category: "billing", action: "trial_fees_changed", detail: data as Record<string, unknown> });
    return await loadTrialConfig();
  });
