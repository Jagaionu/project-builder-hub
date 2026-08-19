// Stripe checkout for the paid trial: charges the trial fee now (incl. VAT) and
// stores the card off-session for the later auto-convert. Server-only.
import Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

export interface TrialCheckoutOpts {
  companyId: string;
  email: string | null;
  name: string;
  countryCode: string;
  trialDays: number;
  feeMinor: number;
  baseUrl: string;
}

export async function createTrialCheckout(opts: TrialCheckoutOpts): Promise<string> {
  const s = stripe();
  const { data: co } = await sb
    .from("companies")
    .select("billing_customer_ref")
    .eq("id", opts.companyId)
    .maybeSingle();
  let customer = (co?.billing_customer_ref as string | null) ?? null;
  if (!customer) {
    const c = await s.customers.create({
      name: opts.name,
      email: opts.email ?? undefined,
      metadata: { companyId: opts.companyId },
      address: { country: opts.countryCode || "GB" },
    });
    customer = c.id;
    await sb.from("companies").update({ billing_customer_ref: customer }).eq("id", opts.companyId);
  }
  const vatMinor = Math.round(opts.feeMinor * 0.2);
  const grossMinor = opts.feeMinor + vatMinor;
  const session = await s.checkout.sessions.create({
    mode: "payment",
    customer,
    // NOTE: setup_future_usage is not allowed with Stripe Managed Payments; the
    // card is saved for auto-convert via the subscription flow (increment 2).
    payment_intent_data: {
      metadata: { companyId: opts.companyId, kind: "trial", trialDays: String(opts.trialDays) },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: grossMinor,
          product_data: { name: opts.trialDays + "-day Prime Route trial (incl. VAT)" },
        },
      },
    ],
    success_url: opts.baseUrl + "/start-trial?status=success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: opts.baseUrl + "/start-trial?status=cancelled",
    metadata: { companyId: opts.companyId, kind: "trial", trialDays: String(opts.trialDays), feeMinor: String(opts.feeMinor) },
  });
  return session.url ?? "";
}

export interface TrialSessionInfo {
  paid: boolean;
  companyId: string | null;
  trialDays: number;
  customerRef: string | null;
}

export async function retrieveTrialSession(sessionId: string): Promise<TrialSessionInfo> {
  const sess = await stripe().checkout.sessions.retrieve(sessionId);
  return {
    paid: sess.payment_status === "paid",
    companyId: (sess.metadata?.companyId as string) ?? null,
    trialDays: Number(sess.metadata?.trialDays ?? 7),
    customerRef: typeof sess.customer === "string" ? sess.customer : null,
  };
}
