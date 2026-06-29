// GoCardless Direct Debit provider.
// Requires env: GOCARDLESS_ACCESS_TOKEN, GOCARDLESS_WEBHOOK_SECRET,
//               GOCARDLESS_ENVIRONMENT ("sandbox" | "live").
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingCustomer,
  ChargeResult,
  CheckoutResult,
  NormalisedEvent,
  PaymentProvider,
  ProviderStatus,
  RefundResult,
} from "../provider";

// gocardless-nodejs ships CommonJS; load lazily so missing creds don't break import.
type GcClient = {
  customers: { create: (p: unknown) => Promise<{ id: string }> };
  billingRequests: { create: (p: unknown) => Promise<{ id: string }> };
  billingRequestFlows: {
    create: (p: unknown) => Promise<{ authorisation_url: string; id: string }>;
  };
  payments: { create: (p: unknown) => Promise<{ id: string; status: string }> };
  refunds: { create: (p: unknown) => Promise<{ id: string; status: string }> };
  mandates: { list: (p: unknown) => Promise<{ mandates: Array<{ id: string; status: string }> }> };
};

let _client: GcClient | null = null;
async function client(): Promise<GcClient> {
  if (_client) return _client;
  const token = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!token) throw new Error("GOCARDLESS_ACCESS_TOKEN is not configured");
  const mod = (await import("gocardless-nodejs")) as unknown as {
    default?: (t: string, env: string) => GcClient;
    constants?: { Environments?: Record<string, string> };
  };
  const factory = mod.default ?? (mod as unknown as (t: string, env: string) => GcClient);
  const env = process.env.GOCARDLESS_ENVIRONMENT === "live" ? "live" : "sandbox";
  _client = factory(token, env);
  return _client;
}

export const gocardlessProvider: PaymentProvider = {
  id: "gocardless",

  async createCustomer(customer: BillingCustomer): Promise<string> {
    if (customer.providerRef) return customer.providerRef;
    const c = await (
      await client()
    ).customers.create({
      email: customer.email,
      company_name: customer.name,
      country_code: customer.countryCode,
      metadata: { companyId: customer.companyId },
    });
    return c.id;
  },

  async createCheckout({ customer, plan, interval, successUrl }): Promise<CheckoutResult> {
    const gc = await client();
    const br = await gc.billingRequests.create({
      mandate_request: { scheme: "bacs", currency: "GBP" },
      metadata: { companyId: customer.companyId, plan, interval },
    });
    const flow = await gc.billingRequestFlows.create({
      redirect_uri: successUrl,
      links: { billing_request: br.id },
    });
    return { redirectUrl: flow.authorisation_url, providerRef: br.id };
  },

  async chargeForPlan({
    customerRef,
    plan,
    interval,
    breakdown,
    description,
  }): Promise<ChargeResult> {
    // customerRef here is the mandate id. Charge the fee-inclusive gross.
    const p = await (
      await client()
    ).payments.create({
      amount: breakdown.grossMinor,
      currency: "GBP",
      description,
      links: { mandate: customerRef },
      metadata: { plan, interval },
    });
    return {
      invoiceProviderRef: p.id,
      status:
        p.status === "confirmed" || p.status === "paid_out"
          ? "paid"
          : p.status === "failed"
            ? "failed"
            : "pending",
    };
  },

  async changePlan({ customerRef, toPlan, interval, breakdown }): Promise<ChargeResult> {
    // GoCardless has no subscription "update with proration"; the orchestrator
    // computes the prorated net and we collect it as a one-off payment.
    return this.chargeForPlan({
      customerRef,
      plan: toPlan,
      interval,
      breakdown,
      description: `Plan change to ${toPlan}`,
    });
  },

  async parseWebhook(rawBody: string, headers: Record<string, string>): Promise<NormalisedEvent> {
    const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;
    if (!secret) throw new Error("GOCARDLESS_WEBHOOK_SECRET is not configured");
    const provided = headers["webhook-signature"] ?? headers["Webhook-Signature"] ?? "";
    const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(provided);
    const b = Buffer.from(computed);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Invalid GoCardless webhook signature");
    }

    const body = JSON.parse(rawBody) as {
      events?: Array<{
        id: string;
        resource_type: string;
        action: string;
        created_at: string;
        links?: Record<string, string>;
      }>;
    };
    const events = body.events ?? [];
    // Map the first actionable event. (A full handler processes every event;
    // the orchestrator re-reads the raw payload for the complete list.)
    const ev = events.find((e) => ["payments", "mandates"].includes(e.resource_type)) ?? events[0];

    const base = {
      provider: "gocardless" as const,
      eventId: ev?.id ?? "unknown",
      occurredAt: ev?.created_at ?? new Date().toISOString(),
      raw: body,
    };
    if (!ev) return { ...base, type: "unknown" };

    if (ev.resource_type === "payments") {
      if (ev.action === "confirmed" || ev.action === "paid_out") {
        return {
          ...base,
          type: "payment_succeeded",
          invoiceRef: ev.links?.payment ?? null,
          companyRef: ev.links?.mandate ?? null,
        };
      }
      if (ev.action === "failed" || ev.action === "cancelled" || ev.action === "charged_back") {
        return {
          ...base,
          type: "payment_failed",
          invoiceRef: ev.links?.payment ?? null,
          companyRef: ev.links?.mandate ?? null,
        };
      }
    }
    if (ev.resource_type === "mandates") {
      if (ev.action === "active")
        return { ...base, type: "mandate_active", companyRef: ev.links?.mandate ?? null };
      if (["failed", "cancelled", "expired"].includes(ev.action)) {
        return { ...base, type: "mandate_failed", companyRef: ev.links?.mandate ?? null };
      }
    }
    return { ...base, type: "unknown" };
  },

  async getStatus(customerRef: string): Promise<ProviderStatus> {
    const res = await (await client()).mandates.list({ customer: customerRef });
    const active = res.mandates?.some((m) => m.status === "active") ?? false;
    return { active, currentPeriodEnd: null, raw: res };
  },

  async refund({ chargeRef, amountMinor }): Promise<RefundResult> {
    if (!chargeRef) throw new Error("GoCardless refund requires a payment reference");
    const r = await (
      await client()
    ).refunds.create({
      amount: amountMinor,
      total_amount_confirmation: amountMinor,
      links: { payment: chargeRef },
    });
    return {
      refundProviderRef: r.id,
      status: r.status === "paid" ? "succeeded" : r.status === "failed" ? "failed" : "pending",
    };
  },
};
