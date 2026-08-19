// Auto-convert paid trials at trial end: create the ongoing Stripe subscription
// off-session on the stored card, crediting the trial fee to the first invoice.
// Managed Payments disabled (we compute VAT ourselves via buildBreakdown).
import Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildBreakdown } from "@/lib/billing/pricing-loader.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

export interface TrialConversionResult {
  converted: number;
  failed: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function convertOne(s: Stripe, c: any): Promise<void> {
  const customer = c.billing_customer_ref as string;
  const plan = (c.plan ?? "starter") as "starter" | "pro" | "enterprise";
  const breakdown = await buildBreakdown({ companyId: c.id, plan, interval: "monthly", provider: "stripe" });

  const pms = await s.paymentMethods.list({ customer, type: "card" });
  const pm = pms.data[0];
  if (pm) {
    await s.customers.update(customer, { invoice_settings: { default_payment_method: pm.id } });
  }

  const credit = Number(c.trial_fee_paid_minor ?? 0);
  if (credit > 0) {
    await s.customers.createBalanceTransaction(customer, {
      amount: -credit,
      currency: "gbp",
      description: "Trial fee credit",
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subParams: any = {
    customer,
    items: [
      {
        price_data: {
          currency: "gbp",
          unit_amount: breakdown.grossMinor,
          recurring: { interval: "month" },
          product_data: { name: plan + " plan (monthly)" },
        },
      },
    ],
    default_payment_method: pm ? pm.id : undefined,
    off_session: true,
    metadata: { companyId: c.id, plan, interval: "monthly", kind: "trial_conversion" },
  };
  const sub = await s.subscriptions.create(subParams as Stripe.SubscriptionCreateParams);
  const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
  const periodEnd = cpe ? new Date(cpe * 1000).toISOString() : null;
  await sb
    .from("companies")
    .update({
      subscription_status: "active",
      billing_provider: "stripe",
      ...(periodEnd ? { current_period_end: periodEnd } : {}),
    } as never)
    .eq("id", c.id);
}

export async function runTrialConversionSweep(): Promise<TrialConversionResult> {
  let converted = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cos: any[] = [];
  try {
    const { data } = await sb
      .from("companies")
      .select("id, plan, billing_customer_ref, trial_fee_paid_minor")
      .eq("requires_trial_payment", true)
      .eq("trial_paid", true)
      .eq("subscription_status", "trial")
      .lte("subscription_ends_at", nowIso)
      .not("billing_customer_ref", "is", null);
    cos = data ?? [];
  } catch {
    return { converted, failed };
  }
  const s = stripe();
  for (const c of cos) {
    try {
      await convertOne(s, c);
      converted += 1;
    } catch {
      // Leave as trial; the next sweep retries, and a failed off-session charge
      // surfaces via the Stripe webhook + existing dunning.
      failed += 1;
    }
  }
  return { converted, failed };
}
