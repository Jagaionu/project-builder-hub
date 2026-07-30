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
  behaviourMaxDevices24h: z.number().int().min(1).optional(),
  behaviourMaxCountries24h: z.number().int().min(1).optional(),
  behaviourMaxJobs24h: z.number().int().min(1).optional(),
  behaviourMaxDrivers24h: z.number().int().min(1).optional(),
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


// ---- Review queue ---------------------------------------------------------

export const listSignupReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const { data: pendingCos } = await sb
      .from("companies")
      .select("id, name, company_number, verification_method, created_at")
      .eq("verification_status", "pending_review")
      .order("created_at", { ascending: false })
      .limit(100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending: any[] = [];
    for (const c of (pendingCos ?? []) as Array<Record<string, unknown>>) {
      const { data: led } = await sb
        .from("trial_signups")
        .select("email, identity_trust, fraud_risk, reason")
        .eq("tenant_id", c.id as string)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: log } = await sb
        .from("signup_decision_log")
        .select("step, detail, created_at")
        .eq("tenant_id", c.id as string)
        .order("created_at", { ascending: true });
      pending.push({
        companyId: c.id,
        name: c.name,
        companyNumber: c.company_number ?? null,
        verificationMethod: c.verification_method ?? null,
        createdAt: c.created_at,
        email: led?.email ?? null,
        identityTrust: led?.identity_trust ?? null,
        fraudRisk: led?.fraud_risk ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reasons: ((led?.reason as any)?.reasons ?? []) as string[],
        decisionLog: (log ?? []) as Array<Record<string, unknown>>,
      });
    }
    const { data: blockedRows } = await sb
      .from("trial_signups")
      .select("id, company_name, company_number, email, identity_trust, fraud_risk, reason, created_at")
      .eq("status", "blocked")
      .order("created_at", { ascending: false })
      .limit(50);
    const blocked = ((blockedRows ?? []) as Array<Record<string, unknown>>).map((b) => ({
      signupId: String(b.id),
      companyName: (b.company_name as string | null) ?? null,
      companyNumber: (b.company_number as string | null) ?? null,
      email: (b.email as string | null) ?? null,
      identityTrust: (b.identity_trust as number | null) ?? null,
      fraudRisk: (b.fraud_risk as number | null) ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reasons: (((b.reason as any)?.reasons as string[] | undefined) ?? []),
      createdAt: String(b.created_at),
    }));
    return { pending, blocked };
  });

export const approveSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const trialEnds = new Date();
    trialEnds.setDate(trialEnds.getDate() + 14);
    await sb
      .from("companies")
      .update({
        verification_status: "verified",
        subscription_status: "trial",
        subscription_ends_at: trialEnds.toISOString(),
      })
      .eq("id", data.companyId);
    await sb.from("trial_signups").update({ status: "approved", decision: "active" }).eq("tenant_id", data.companyId);
    await sb
      .from("signup_decision_log")
      .insert({ tenant_id: data.companyId, step: "review_action", detail: { action: "approve", by: context.userId } } as never);
    return { ok: true };
  });

export const rejectSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    await sb
      .from("companies")
      .update({ verification_status: "blocked", subscription_status: "cancelled" })
      .eq("id", data.companyId);
    await sb.from("trial_signups").update({ status: "blocked", decision: "blocked" }).eq("tenant_id", data.companyId);
    await sb
      .from("signup_decision_log")
      .insert({ tenant_id: data.companyId, step: "review_action", detail: { action: "reject", by: context.userId } } as never);
    return { ok: true };
  });

// Grant a fresh trial to a previously-blocked business: clears the cooldown on
// their ledger row so their next signup attempt passes. No manual DB edits.
export const grantNewTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ signupId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { data: row } = await sb
      .from("trial_signups")
      .select("tenant_id, company_number")
      .eq("id", data.signupId)
      .maybeSingle();
    await sb
      .from("trial_signups")
      .update({ last_trial_at: null, decision: "granted_new_trial" })
      .eq("id", data.signupId);
    await sb.from("signup_decision_log").insert({
      signup_id: data.signupId,
      tenant_id: row?.tenant_id ?? null,
      step: "review_action",
      detail: { action: "grant_new_trial", by: context.userId, companyNumber: row?.company_number ?? null },
    } as never);
    return { ok: true };
  });
