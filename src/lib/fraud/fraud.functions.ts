// Super-admin fraud/abuse server functions: read/update the DB-backed settings
// (no deploy needed) and read basic dashboard metrics.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadFraudSettings, saveFraudSettings } from "./fraud-config.server";
import type { FraudSettings } from "./fraud-config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

async function assertSuperAdmin(userId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Forbidden: super admin only");
}

export const getFraudSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    return await loadFraudSettings();
  });

const SettingsPatch = z.object({
  riskThreshold: z.number().int().min(0).optional(),
  trustMin: z.number().int().min(0).optional(),
  cooldownMonths: z.number().int().min(0).optional(),
  rateLimitMaxAttempts: z.number().int().min(1).optional(),
  rateLimitWindowMinutes: z.number().int().min(1).optional(),
  weightIdentityCh: z.number().int().optional(),
  weightIdentityManual: z.number().int().optional(),
  weightIdentityBusinessEmail: z.number().int().optional(),
  weightIdentityDirector: z.number().int().optional(),
  weightRiskDevice: z.number().int().optional(),
  weightRiskIp: z.number().int().optional(),
  weightRiskFreeEmail: z.number().int().optional(),
  weightRiskDisposableEmail: z.number().int().optional(),
  weightRiskFailedSignups: z.number().int().optional(),
  trustedMinPaidInvoices: z.number().int().min(0).optional(),
  trustedMinActiveDays: z.number().int().min(0).optional(),
});

export const updateFraudSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SettingsPatch.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    await saveFraudSettings(data as Partial<FraudSettings>);
    return await loadFraudSettings();
  });

export const getFraudMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const iso = start.toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function count(table: string, build: (q: any) => any): Promise<number> {
      try {
        const { count: c } = await build(sb.from(table).select("id", { count: "exact", head: true }));
        return c ?? 0;
      } catch {
        return 0;
      }
    }
    const trialsToday = await count("trial_signups", (q) => q.gte("created_at", iso));
    const pendingReviews = await count("companies", (q) => q.eq("verification_status", "pending_review"));
    const duplicateBlocks = await count("trial_signups", (q) => q.eq("status", "blocked"));
    const approved = await count("trial_signups", (q) => q.eq("status", "approved"));
    return { trialsToday, pendingReviews, duplicateBlocks, approved };
  });
