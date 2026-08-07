import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSuperAdmin } from "@/lib/auth-helpers.server";
import Stripe from "stripe";

export type PaymentsConfigStatus = {
  stripe: { secretKey: boolean; webhookSecret: boolean };
  gocardless: { accessToken: boolean; webhookSecret: boolean; environment: string | null };
  appBaseUrl: boolean;
  push: { publicKey: boolean; privateKey: boolean };
};

// Reports only whether each platform secret is PRESENT — never the values.
export const getPaymentsConfigStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentsConfigStatus> => {
    if (!(await isSuperAdmin(context.userId))) throw new Error("Forbidden");
    const has = (v: string | undefined) => !!(v && v.trim().length > 0);
    return {
      stripe: {
        secretKey: has(process.env.STRIPE_SECRET_KEY),
        webhookSecret: has(process.env.STRIPE_WEBHOOK_SECRET),
      },
      gocardless: {
        accessToken: has(process.env.GOCARDLESS_ACCESS_TOKEN),
        webhookSecret: has(process.env.GOCARDLESS_WEBHOOK_SECRET),
        environment: process.env.GOCARDLESS_ENVIRONMENT ?? null,
      },
      appBaseUrl: has(process.env.APP_BASE_URL),
      push: {
        publicKey: has(process.env.VAPID_PUBLIC_KEY),
        privateKey: has(process.env.VAPID_PRIVATE_KEY),
      },
    };
  });


export type StripeTestResult = { ok: boolean; livemode?: boolean; error?: string };

// Actively pings Stripe with the configured secret key to confirm it is valid
// and reports whether it is a test or live key. Never returns the key.
export const testStripeConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StripeTestResult> => {
    if (!(await isSuperAdmin(context.userId))) throw new Error("Forbidden");
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return { ok: false, error: "STRIPE_SECRET_KEY is not set (redeploy after adding it)." };
    try {
      const stripe = new Stripe(key);
      const bal = await stripe.balance.retrieve();
      return { ok: true, livemode: bal.livemode };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Stripe API call failed" };
    }
  });
