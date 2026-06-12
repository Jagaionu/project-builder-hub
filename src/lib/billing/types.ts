// Billing domain types. Money is ALWAYS integer minor units (pence). No floats.

export type Provider = "stripe" | "gocardless" | "bank_transfer";
export type CardRegion = "uk" | "eu" | "intl" | "any";
export type PlanTier = "starter" | "pro" | "enterprise";
export type BillingInterval = "monthly" | "annual";

/** Company subscription lifecycle status (mirrors companies.subscription_status). */
export type SubscriptionStatus = "active" | "trial" | "suspended" | "cancelled";

/** VAT treatment for an invoice. Only `standard` produces tax > 0. */
export type TaxMethod = "standard" | "reverse_charge" | "zero_rated" | "exempt";

export type ProrationBehavior = "immediate_charge" | "immediate_credit" | "at_period_end";

export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "failed"
  | "void"
  | "refunded"
  | "uncollectible";

/** Fee schedule row used to gross-up a charge so the processor fee is covered. */
export interface FeeConfig {
  provider: Provider;
  card_region: CardRegion;
  /** Basis points. 150 = 1.5%. */
  percentage_bp: number;
  /** Fixed per-transaction fee in minor units. */
  fixed_fee_minor: number;
  /** Optional fee cap in minor units (e.g. GoCardless £4.00 = 400). */
  cap_minor: number | null;
}

/** Full money breakdown for a charge. gross = net + tax + fee. */
export interface PriceBreakdown {
  netMinor: number;
  taxMinor: number;
  feeMinor: number;
  grossMinor: number;
  taxRateBp: number;
  taxMethod: TaxMethod;
  currency: string;
}

/** EU member-state ISO country codes (for reverse-charge determination). */
export const EU_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);
