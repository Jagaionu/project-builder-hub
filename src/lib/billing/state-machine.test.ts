import { describe, it, expect } from "vitest";
import {
  DEFAULT_BILLING_POLICY,
  dunningStepForFailure,
  reduceBilling,
  type BillingState,
} from "./state-machine";

const trial: BillingState = {
  subscriptionStatus: "trial",
  subscriptionEndsAt: "2026-06-20T00:00:00Z",
};
const active: BillingState = {
  subscriptionStatus: "active",
  subscriptionEndsAt: "2026-07-01T00:00:00Z",
};

describe("dunningStepForFailure", () => {
  it("ladders day1 -> day3 -> suspended_warning", () => {
    expect(dunningStepForFailure(1)).toBe("day1");
    expect(dunningStepForFailure(2)).toBe("day3");
    expect(dunningStepForFailure(3)).toBe("suspended_warning");
    expect(dunningStepForFailure(5)).toBe("suspended_warning");
  });
});

describe("reduceBilling", () => {
  it("payment_succeeded activates and sets the new period end", () => {
    const t = reduceBilling(trial, {
      kind: "payment_succeeded",
      periodEnd: "2026-07-10T00:00:00Z",
    });
    expect(t.nextStatus).toBe("active");
    expect(t.subscriptionEndsAt).toBe("2026-07-10T00:00:00Z");
    expect(t.actions).toContainEqual({ type: "activate" });
  });

  it("bank_transfer_reconciled activates like a successful payment", () => {
    const t = reduceBilling(trial, {
      kind: "bank_transfer_reconciled",
      periodEnd: "2026-07-10T00:00:00Z",
    });
    expect(t.nextStatus).toBe("active");
    expect(t.actions).toContainEqual({ type: "activate" });
  });

  it("first payment failure duns (day1) but keeps access", () => {
    const t = reduceBilling(active, { kind: "payment_failed", failureCount: 1 });
    expect(t.nextStatus).toBe("active");
    expect(t.actions).toContainEqual({ type: "send_dunning", step: "day1" });
    expect(t.actions).not.toContainEqual({ type: "suspend" });
  });

  it("second failure duns (day3) and still keeps access", () => {
    const t = reduceBilling(active, { kind: "payment_failed", failureCount: 2 });
    expect(t.nextStatus).toBe("active");
    expect(t.actions).toContainEqual({ type: "send_dunning", step: "day3" });
  });

  it("failure at the grace limit suspends and sends final warning", () => {
    const t = reduceBilling(active, {
      kind: "payment_failed",
      failureCount: DEFAULT_BILLING_POLICY.maxFailuresBeforeSuspend,
    });
    expect(t.nextStatus).toBe("suspended");
    expect(t.actions).toContainEqual({ type: "send_dunning", step: "suspended_warning" });
    expect(t.actions).toContainEqual({ type: "suspend" });
  });

  it("subscription_cancelled schedules cancellation", () => {
    const t = reduceBilling(active, { kind: "subscription_cancelled" });
    expect(t.nextStatus).toBe("cancelled");
    expect(t.actions).toContainEqual({ type: "schedule_cancellation" });
  });

  it("plan_changed applies entitlements without changing status", () => {
    const t = reduceBilling(active, { kind: "plan_changed", newPlan: "enterprise" });
    expect(t.nextStatus).toBe("active");
    expect(t.actions).toContainEqual({ type: "apply_plan_entitlements", plan: "enterprise" });
  });

  it("trial_expired suspends", () => {
    const t = reduceBilling(trial, { kind: "trial_expired" });
    expect(t.nextStatus).toBe("suspended");
    expect(t.actions).toContainEqual({ type: "suspend" });
  });
});
