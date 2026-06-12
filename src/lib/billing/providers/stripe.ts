// Stripe Billing provider. Requires env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// We compute fee-inclusive GROSS amounts ourselves (pricing engine) and charge
// that, so the customer covers Stripe's processing fee.
import Stripe from "stripe";
import type {
  BillingCustomer,
  ChargeResult,
  CheckoutResult,
  NormalisedEvent,
  PaymentProvider,
  ProviderStatus,
} from "../provider";
import type { ProrationBehavior } from "../types";

let _stripe: Stripe | null = null;
function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  _stripe = new Stripe(key);
  return _stripe;
}

function mapProration(b: ProrationBehavior): Stripe.SubscriptionUpdateParams.ProrationBehavior {
  switch (b) {
    case "immediate_charge":
    case "immediate_credit":
      return "create_prorations";
    case "at_period_end":
      return "none";
  }
}

export const stripeProvider: PaymentProvider = {
  id: "stripe",

  async createCustomer(customer: BillingCustomer): Promise<string> {
    if (customer.providerRef) return customer.providerRef;
    const c = await stripe().customers.create({
      name: customer.name,
      email: customer.email,
      metadata: { companyId: customer.companyId },
      address: { country: customer.countryCode },
      ...(customer.vatNumber
        ? { tax_id_data: [{ type: "gb_vat", value: customer.vatNumber }] }
        : {}),
    });
    return c.id;
  },

  async createCheckout({
    customer,
    plan,
    interval,
    breakdown,
    successUrl,
    cancelUrl,
  }): Promise<CheckoutResult> {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: customer.providerRef ?? undefined,
      customer_email: customer.providerRef ? undefined : customer.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: breakdown.currency.toLowerCase(),
            // Charge the fee-inclusive gross. Recurring on the plan interval.
            unit_amount: breakdown.grossMinor,
            recurring: { interval: interval === "annual" ? "year" : "month" },
            product_data: { name: `${plan} plan (${interval})` },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { companyId: customer.companyId, plan, interval },
    });
    return { redirectUrl: session.url ?? "", providerRef: session.id };
  },

  async chargeForPlan({
    customerRef,
    plan,
    interval,
    breakdown,
    description,
  }): Promise<ChargeResult> {
    // One-off charge off-session using the customer's default payment method.
    const intent = await stripe().paymentIntents.create({
      amount: breakdown.grossMinor,
      currency: breakdown.currency.toLowerCase(),
      customer: customerRef,
      off_session: true,
      confirm: true,
      description,
      metadata: { plan, interval },
    });
    return {
      invoiceProviderRef: intent.id,
      status:
        intent.status === "succeeded"
          ? "paid"
          : intent.status === "processing"
            ? "pending"
            : "failed",
    };
  },

  async changePlan({ customerRef, toPlan, interval, behavior, breakdown }): Promise<ChargeResult> {
    // Find the active subscription for the customer and update its price.
    const subs = await stripe().subscriptions.list({
      customer: customerRef,
      status: "active",
      limit: 1,
    });
    const sub = subs.data[0];
    if (!sub) throw new Error("No active subscription to change");
    const item = sub.items.data[0];
    const updated = await stripe().subscriptions.update(sub.id, {
      proration_behavior: mapProration(behavior),
      items: [
        {
          id: item.id,
          price_data: {
            currency: breakdown.currency.toLowerCase(),
            unit_amount: breakdown.grossMinor,
            recurring: { interval: interval === "annual" ? "year" : "month" },
            product:
              typeof item.price.product === "string" ? item.price.product : item.price.product.id,
          } as unknown as string,
        } as unknown as Stripe.SubscriptionUpdateParams.Item,
      ],
      metadata: { plan: toPlan, interval },
    });
    return { invoiceProviderRef: updated.latest_invoice as string, status: "pending" };
  },

  async parseWebhook(rawBody: string, headers: Record<string, string>): Promise<NormalisedEvent> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    const sig = headers["stripe-signature"] ?? headers["Stripe-Signature"];
    if (!sig) throw new Error("Missing stripe-signature header");
    const event = stripe().webhooks.constructEvent(rawBody, sig, secret);

    const base = {
      provider: "stripe" as const,
      eventId: event.id,
      occurredAt: new Date(event.created * 1000).toISOString(),
      raw: event,
    };
    switch (event.type) {
      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;
        return {
          ...base,
          type: "payment_succeeded",
          companyRef: inv.customer as string,
          invoiceRef: inv.id,
        };
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        return {
          ...base,
          type: "payment_failed",
          companyRef: inv.customer as string,
          invoiceRef: inv.id,
        };
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        return { ...base, type: "subscription_cancelled", companyRef: sub.customer as string };
      }
      default:
        return { ...base, type: "unknown" };
    }
  },

  async getStatus(customerRef: string): Promise<ProviderStatus> {
    const subs = await stripe().subscriptions.list({
      customer: customerRef,
      status: "active",
      limit: 1,
    });
    const sub = subs.data[0];
    if (!sub) return { active: false, currentPeriodEnd: null };
    const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
    return {
      active: true,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      raw: sub,
    };
  },
};
