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
