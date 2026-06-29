// Pure proration calculator for mid-term plan changes. Works on NET amounts
// (pence); tax and fees are recomputed on the prorated net by the pricing
// engine. Time-based proration over the current billing period.

import type { ProrationBehavior } from "./types";

export interface ProrationArgs {
  oldNetMinor: number;
  newNetMinor: number;
  periodStart: Date;
  periodEnd: Date;
  changeAt: Date;
  behavior: ProrationBehavior;
}

export interface ProrationResult {
  /** Net adjustment in minor units. Positive = charge, negative = credit. */
  amountMinor: number;
  isCredit: boolean;
  /** Fraction of the period remaining at the change moment (0..1). */
  remainingFraction: number;
  /** Whether the change takes effect now or is deferred to renewal. */
  effective: "now" | "at_period_end";
}

/**
 * Compute the prorated net adjustment when switching from oldNet to newNet
 * partway through a period.
 *  - immediate_charge / immediate_credit: prorate the difference over the
 *    remaining fraction of the period and apply now.
 *  - at_period_end: no adjustment now; the new price applies at renewal.
 */
export function computeProration(args: ProrationArgs): ProrationResult {
  const { oldNetMinor, newNetMinor, periodStart, periodEnd, changeAt, behavior } = args;

  if (behavior === "at_period_end") {
    return { amountMinor: 0, isCredit: false, remainingFraction: 0, effective: "at_period_end" };
  }

  const totalMs = periodEnd.getTime() - periodStart.getTime();
  if (totalMs <= 0) throw new Error("periodEnd must be after periodStart");

  // Clamp to [0, totalMs] so changes before/after the window behave sanely.
  const remainingMs = Math.min(Math.max(periodEnd.getTime() - changeAt.getTime(), 0), totalMs);
  const remainingFraction = remainingMs / totalMs;

  const diff = newNetMinor - oldNetMinor; // positive = upgrade
  const amountMinor = Math.round(diff * remainingFraction);

  return {
    amountMinor,
    isCredit: amountMinor < 0,
    remainingFraction,
    effective: "now",
  };
}

export interface CancellationRefundArgs {
  /** Amount eligible for refund (minor units). Typically net + tax; the
   *  processing fee is non-refundable. */
  refundableMinor: number;
  periodStart: Date;
  periodEnd: Date;
  cancelAt: Date;
}

export interface CancellationRefundResult {
  refundMinor: number;
  remainingFraction: number;
  remainingDays: number;
  totalDays: number;
}

/**
 * Pro-rata refund for the UNUSED portion of the current period when a
 * subscription is cancelled. Day-accurate: it works on the real period
 * timestamps, so 28/29/30/31-day months are handled correctly without an
 * explicit daily rate (the implied daily rate is refundableMinor / totalDays).
 */
export function computeCancellationRefund(
  args: CancellationRefundArgs,
): CancellationRefundResult {
  const { refundableMinor, periodStart, periodEnd, cancelAt } = args;
  const DAY = 86400000;
  const totalMs = periodEnd.getTime() - periodStart.getTime();
  if (totalMs <= 0) {
    return { refundMinor: 0, remainingFraction: 0, remainingDays: 0, totalDays: 0 };
  }
  const remainingMs = Math.min(Math.max(periodEnd.getTime() - cancelAt.getTime(), 0), totalMs);
  const remainingFraction = remainingMs / totalMs;
  const refundMinor = Math.max(0, Math.round(refundableMinor * remainingFraction));
  return {
    refundMinor,
    remainingFraction,
    remainingDays: Math.ceil(remainingMs / DAY),
    totalDays: Math.round(totalMs / DAY),
  };
}
