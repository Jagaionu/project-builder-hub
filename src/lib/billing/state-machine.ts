// Pure entitlement state machine. Both provider webhooks AND super-admin
// actions feed events in here; it returns the next subscription status plus a
// list of side-effect *intents* (the caller performs the I/O). Keeping this
// pure makes the automation logic exhaustively testable.

import type { PlanTier, SubscriptionStatus } from "./types";

// Re-declare locally to avoid importing the app-wide types module here.
export type { SubscriptionStatus } from "./types";

export type DunningStep = "day1" | "day3" | "suspended_warning";

export type BillingEvent =
  | { kind: "payment_succeeded"; periodEnd: string }
  | { kind: "payment_failed"; failureCount: number }
  | { kind: "subscription_cancelled" }
  | { kind: "plan_changed"; newPlan: PlanTier }
  | { kind: "trial_expired" }
  | { kind: "bank_transfer_reconciled"; periodEnd: string };

export interface BillingState {
  subscriptionStatus: SubscriptionStatus;
  subscriptionEndsAt: string | null;
}

export type BillingAction =
  | { type: "activate" }
  | { type: "suspend" }
  | { type: "apply_plan_entitlements"; plan: PlanTier }
  | { type: "send_dunning"; step: DunningStep }
  | { type: "schedule_cancellation" };

export interface Transition {
  nextStatus: SubscriptionStatus;
  subscriptionEndsAt: string | null;
  actions: BillingAction[];
}

export interface BillingPolicy {
  /** Number of consecutive payment failures tolerated before suspension. */
  maxFailuresBeforeSuspend: number;
}

export const DEFAULT_BILLING_POLICY: BillingPolicy = {
  maxFailuresBeforeSuspend: 3,
};

/** Map a payment-failure count to the dunning step that should be sent. */
export function dunningStepForFailure(
  failureCount: number,
  policy: BillingPolicy = DEFAULT_BILLING_POLICY,
): DunningStep {
  if (failureCount <= 1) return "day1";
  if (failureCount < policy.maxFailuresBeforeSuspend) return "day3";
  return "suspended_warning";
}

export function reduceBilling(
  state: BillingState,
  event: BillingEvent,
  policy: BillingPolicy = DEFAULT_BILLING_POLICY,
): Transition {
  switch (event.kind) {
    case "payment_succeeded":
    case "bank_transfer_reconciled":
      return {
        nextStatus: "active",
        subscriptionEndsAt: event.periodEnd,
        actions: [{ type: "activate" }],
      };

    case "payment_failed": {
      const step = dunningStepForFailure(event.failureCount, policy);
      const actions: BillingAction[] = [{ type: "send_dunning", step }];
      // Suspend once we've exhausted the grace window.
      if (event.failureCount >= policy.maxFailuresBeforeSuspend) {
        actions.push({ type: "suspend" });
        return {
          nextStatus: "suspended",
          subscriptionEndsAt: state.subscriptionEndsAt,
          actions,
        };
      }
      // Still in grace: keep current access, just dun.
      return {
        nextStatus: state.subscriptionStatus,
        subscriptionEndsAt: state.subscriptionEndsAt,
        actions,
      };
    }

    case "subscription_cancelled":
      return {
        nextStatus: "cancelled",
        subscriptionEndsAt: state.subscriptionEndsAt,
        actions: [{ type: "schedule_cancellation" }],
      };

    case "plan_changed":
      // Plan/level change applies new entitlements; does not by itself change
      // the active/suspended status.
      return {
        nextStatus: state.subscriptionStatus,
        subscriptionEndsAt: state.subscriptionEndsAt,
        actions: [{ type: "apply_plan_entitlements", plan: event.newPlan }],
      };

    case "trial_expired":
      return {
        nextStatus: "suspended",
        subscriptionEndsAt: state.subscriptionEndsAt,
        actions: [{ type: "suspend" }],
      };
  }
}
