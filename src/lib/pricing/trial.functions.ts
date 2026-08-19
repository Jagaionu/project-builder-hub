// Paid-trial server functions: read trial options, start Stripe checkout, and
// confirm payment (activating the trial). One paid trial per company.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadTrialConfig } from "./trial-config.server";
import { trialFeeMinor } from "./trial-config";
import { createTrialCheckout, retrieveTrialSession } from "./trial-checkout.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

async function tenantForUser(userId: string): Promise<{ companyId: string; email: string | null }> {
  const { data } = await sb
    .from("company_members")
    .select("company_id, email")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("No company for this user");
  return { companyId: data.company_id as string, email: (data.email as string | null) ?? null };
}

export const getTrialOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await tenantForUser(context.userId);
    const cfg = await loadTrialConfig();
    return {
      currency: cfg.currency,
      trial7FeeMinor: cfg.trial7FeeMinor,
      trial14FeeMinor: cfg.trial14FeeMinor,
      defaultTrialDays: cfg.defaultTrialDays,
    };
  });

export const startTrialCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trialDays: z.number().int() }).parse(d))
  .handler(async ({ data, context }) => {
    const { companyId, email } = await tenantForUser(context.userId);
    const { data: company } = await sb
      .from("companies")
      .select("name, country_code, requires_trial_payment, trial_paid")
      .eq("id", companyId)
      .maybeSingle();
    if (!company) throw new Error("Company not found");
    if (company.trial_paid) throw new Error("Your trial has already been started.");
    const cfg = await loadTrialConfig();
    const days = data.trialDays >= 14 ? 14 : 7;
    const fee = trialFeeMinor(days, cfg);
    const base = process.env.APP_BASE_URL ?? "https://theprimeroute.co.uk";
    const url = await createTrialCheckout({
      companyId,
      email,
      name: (company.name as string) ?? "Company",
      countryCode: (company.country_code as string) ?? "GB",
      trialDays: days,
      feeMinor: fee,
      baseUrl: base,
    });
    return { url };
  });

export const confirmTrialPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { companyId } = await tenantForUser(context.userId);
    const sess = await retrieveTrialSession(data.sessionId);
    if (!sess.paid) return { ok: false };
    if (sess.companyId && sess.companyId !== companyId) throw new Error("Session does not match your account.");
    const ends = new Date();
    ends.setDate(ends.getDate() + (sess.trialDays >= 14 ? 14 : 7));
    await sb
      .from("companies")
      .update({
        trial_paid: true,
        subscription_status: "trial",
        subscription_ends_at: ends.toISOString(),
        trial_fee_paid_minor: sess.feeMinor,
        ...(sess.customerRef ? { billing_customer_ref: sess.customerRef } : {}),
      } as never)
      .eq("id", companyId);
    return { ok: true };
  });
