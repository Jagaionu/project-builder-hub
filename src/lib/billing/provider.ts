// The single abstraction every payment provider implements. The rest of the
// app (admin tab, automations, customer pages) only ever talks to this
// interface, never to Stripe/GoCardless SDKs directly.

import type {
  BillingInterval,
  PlanTier,
  PriceBreakdown,
  Provider,
  ProrationBehavior,
} from "./types";

export interface BillingCustomer {
  companyId: string;
  name: string;
  email: string;
  countryCode: string;
  vatNumber?: string | null;
  /** Existing provider customer ref, if the company already has one. */
  providerRef?: string | null;
}

export interface CheckoutResult {
  /** URL to redirect the customer to (hosted checkout / mandate flow). */
  redirectUrl: string;
  /** Provider-side reference for the checkout/billing-request. */
  providerRef: string;
}

export interface ChargeResult {
  invoiceProviderRef: string;
  status: "pending" | "paid" | "failed";
}

export interface ProviderStatus {
  active: boolean;
  currentPeriodEnd: string | null;
  raw?: unknown;
}

/** Normalised event produced after a provider webhook is decoded. */
export interface NormalisedEvent {
  provider: Provider;
  eventId: string;
  type:
    | "payment_succeeded"
    | "payment_failed"
    | "subscription_cancelled"
    | "mandate_active"
    | "mandate_failed"
    | "unknown";
  companyRef?: string | null;
  invoiceRef?: string | null;
  occurredAt: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly id: Provider;

  /** Create (or fetch) the provider-side customer; returns its ref. */
  createCustomer(customer: BillingCustomer): Promise<string>;

  /**
   * Begin a hosted checkout / mandate-setup flow for a plan.
   * `breakdown` carries the fee-inclusive gross the customer will be charged.
   */
  createCheckout(args: {
    customer: BillingCustomer;
    plan: PlanTier;
    interval: BillingInterval;
    breakdown: PriceBreakdown;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutResult>;

  /** Charge a company for a plan period (used for recurring / one-off charges). */
  chargeForPlan(args: {
    customerRef: string;
    plan: PlanTier;
    interval: BillingInterval;
    breakdown: PriceBreakdown;
    description: string;
  }): Promise<ChargeResult>;

  /** Apply a mid-term plan change with the given proration behaviour. */
  changePlan(args: {
    customerRef: string;
    fromPlan: PlanTier;
    toPlan: PlanTier;
    interval: BillingInterval;
    behavior: ProrationBehavior;
    breakdown: PriceBreakdown;
  }): Promise<ChargeResult>;

  /** Verify a webhook signature and decode it into a normalised event. */
  parseWebhook(rawBody: string, headers: Record<string, string>): Promise<NormalisedEvent>;

  /** Current subscription status for a customer. */
  getStatus(customerRef: string): Promise<ProviderStatus>;
}
