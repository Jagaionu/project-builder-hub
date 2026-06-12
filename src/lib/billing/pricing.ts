// Pure pricing & tax engine. No I/O, fully unit-testable.
//
// Order of operations (UK B2B SaaS): net -> tax -> fee.
//   1. net    : plan price (pence)
//   2. tax    : VAT applied to net (0 for reverse_charge / zero_rated / exempt)
//   3. fee    : processor fee grossed-up over the tax-inclusive amount, because
//               the fee is charged on the total money actually moved.
//   gross = net + tax + fee
//
// All amounts are integer minor units (pence). Rounding:
//   - tax  uses Math.round (HMRC permits per-line rounding)
//   - fee  uses Math.ceil  so we never under-collect the processor fee

import { EU_COUNTRY_CODES, type FeeConfig, type PriceBreakdown, type TaxMethod } from "./types";

/** Standard UK VAT rate in basis points (20%). */
export const UK_VAT_BP = 2000;

export interface DetermineTaxArgs {
  countryCode: string;
  vatNumber?: string | null;
  vatValidated?: boolean;
}

/**
 * Decide the VAT treatment for a customer.
 *  - UK (GB) customers: standard 20% VAT.
 *  - EU customers with a validated VAT number: reverse charge (0% — customer self-accounts).
 *  - Everyone else outside the UK: zero-rated export of services.
 * EU customers WITHOUT a validated VAT number are treated as standard-rated
 * (conservative: charge VAT rather than wrongly zero-rate).
 */
export function determineTaxMethod({
  countryCode,
  vatNumber,
  vatValidated,
}: DetermineTaxArgs): TaxMethod {
  const cc = (countryCode || "").toUpperCase();
  if (cc === "GB") return "standard";
  const hasValidVat = Boolean(vatNumber && vatValidated);
  if (EU_COUNTRY_CODES.has(cc) && hasValidVat) return "reverse_charge";
  if (EU_COUNTRY_CODES.has(cc)) return "standard";
  // Non-UK, non-EU: export of services, outside the scope of UK VAT.
  return "zero_rated";
}

/** VAT amount (pence) for a net amount under the given method. */
export function applyTax(netMinor: number, method: TaxMethod, rateBp: number): number {
  assertNonNegativeInt(netMinor, "netMinor");
  if (method !== "standard") return 0;
  if (rateBp <= 0) return 0;
  return Math.round((netMinor * rateBp) / 10000);
}

/**
 * Gross-up the processor fee so the customer covers it.
 *   gross = ceil((amount + fixed) / (1 - pct))
 *   fee   = gross - amount   (then capped if a cap is configured)
 * Returns the fee in minor units.
 */
export function grossUpFee(amountMinor: number, fee: FeeConfig): number {
  assertNonNegativeInt(amountMinor, "amountMinor");
  const pct = fee.percentage_bp / 10000;
  if (pct === 0 && fee.fixed_fee_minor === 0) return 0;
  if (pct >= 1) {
    throw new Error("Fee percentage must be < 100%");
  }
  const gross = Math.ceil((amountMinor + fee.fixed_fee_minor) / (1 - pct));
  let feeMinor = gross - amountMinor;
  if (fee.cap_minor != null && feeMinor > fee.cap_minor) {
    feeMinor = fee.cap_minor;
  }
  return feeMinor;
}

export interface PriceForPlanArgs {
  netMinor: number;
  countryCode: string;
  vatNumber?: string | null;
  vatValidated?: boolean;
  fee: FeeConfig;
  /** VAT rate in basis points. Defaults to UK standard 20%. */
  taxRateBp?: number;
  currency?: string;
  /** Override the computed tax method (e.g. exempt customers). */
  taxMethodOverride?: TaxMethod;
}

/** Compute the full money breakdown for charging a plan to a customer. */
export function priceForPlan(args: PriceForPlanArgs): PriceBreakdown {
  const {
    netMinor,
    countryCode,
    vatNumber,
    vatValidated,
    fee,
    taxRateBp = UK_VAT_BP,
    currency = "GBP",
    taxMethodOverride,
  } = args;

  assertNonNegativeInt(netMinor, "netMinor");

  const taxMethod =
    taxMethodOverride ?? determineTaxMethod({ countryCode, vatNumber, vatValidated });

  const taxMinor = applyTax(netMinor, taxMethod, taxRateBp);
  const taxedMinor = netMinor + taxMinor;
  const feeMinor = grossUpFee(taxedMinor, fee);
  const grossMinor = taxedMinor + feeMinor;

  return {
    netMinor,
    taxMinor,
    feeMinor,
    grossMinor,
    taxRateBp: taxMethod === "standard" ? taxRateBp : 0,
    taxMethod,
    currency,
  };
}

/** Format minor units as a currency string for display (e.g. 60400 -> "£604.00"). */
export function formatMinor(minor: number, currency = "GBP"): string {
  const symbol = currency === "GBP" ? "£" : "";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${symbol}${(abs / 100).toFixed(2)}`;
}

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (minor units), got ${value}`);
  }
}
