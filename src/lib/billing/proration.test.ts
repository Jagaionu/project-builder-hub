import { describe, it, expect } from "vitest";
import { computeProration, computeCancellationRefund } from "./proration";

const periodStart = new Date("2026-06-01T00:00:00Z");
const periodEnd = new Date("2026-07-01T00:00:00Z"); // 30 days

describe("computeProration", () => {
  it("upgrade halfway charges half the difference", () => {
    const r = computeProration({
      oldNetMinor: 10000, // £100 starter
      newNetMinor: 60000, // £600 pro
      periodStart,
      periodEnd,
      changeAt: new Date("2026-06-16T00:00:00Z"), // 15 days in -> 50% remaining
      behavior: "immediate_charge",
    });
    expect(r.remainingFraction).toBeCloseTo(0.5, 5);
    expect(r.amountMinor).toBe(25000); // 50% of £500 diff
    expect(r.isCredit).toBe(false);
    expect(r.effective).toBe("now");
  });

  it("downgrade halfway yields a credit (negative)", () => {
    const r = computeProration({
      oldNetMinor: 60000,
      newNetMinor: 10000,
      periodStart,
      periodEnd,
      changeAt: new Date("2026-06-16T00:00:00Z"),
      behavior: "immediate_credit",
    });
    expect(r.amountMinor).toBe(-25000);
    expect(r.isCredit).toBe(true);
  });

  it("at_period_end defers the change with no adjustment now", () => {
    const r = computeProration({
      oldNetMinor: 10000,
      newNetMinor: 60000,
      periodStart,
      periodEnd,
      changeAt: new Date("2026-06-16T00:00:00Z"),
      behavior: "at_period_end",
    });
    expect(r.amountMinor).toBe(0);
    expect(r.effective).toBe("at_period_end");
  });

  it("change at period start charges the full difference", () => {
    const r = computeProration({
      oldNetMinor: 10000,
      newNetMinor: 60000,
      periodStart,
      periodEnd,
      changeAt: periodStart,
      behavior: "immediate_charge",
    });
    expect(r.remainingFraction).toBeCloseTo(1, 5);
    expect(r.amountMinor).toBe(50000);
  });

  it("change after period end charges nothing (clamped)", () => {
    const r = computeProration({
      oldNetMinor: 10000,
      newNetMinor: 60000,
      periodStart,
      periodEnd,
      changeAt: new Date("2026-07-15T00:00:00Z"),
      behavior: "immediate_charge",
    });
    expect(r.remainingFraction).toBe(0);
    expect(r.amountMinor).toBe(0);
  });

  it("throws on a zero-length period", () => {
    expect(() =>
      computeProration({
        oldNetMinor: 1,
        newNetMinor: 2,
        periodStart,
        periodEnd: periodStart,
        changeAt: periodStart,
        behavior: "immediate_charge",
      }),
    ).toThrow();
  });
});

describe("computeCancellationRefund", () => {
  const ps = new Date("2026-06-01T00:00:00Z");
  const pe = new Date("2026-07-01T00:00:00Z"); // 30 days

  it("refunds the unused fraction after 15 days (half)", () => {
    const r = computeCancellationRefund({
      refundableMinor: 12000, // net+tax for the month
      periodStart: ps,
      periodEnd: pe,
      cancelAt: new Date("2026-06-16T00:00:00Z"), // 15 days used -> 50% left
    });
    expect(r.remainingFraction).toBeCloseTo(0.5, 5);
    expect(r.refundMinor).toBe(6000);
    expect(r.totalDays).toBe(30);
  });

  it("refunds nothing once the period has fully elapsed", () => {
    const r = computeCancellationRefund({
      refundableMinor: 12000,
      periodStart: ps,
      periodEnd: pe,
      cancelAt: new Date("2026-07-02T00:00:00Z"),
    });
    expect(r.refundMinor).toBe(0);
    expect(r.remainingDays).toBe(0);
  });

  it("is day-accurate for a 28-day month (Feb)", () => {
    const r = computeCancellationRefund({
      refundableMinor: 2800,
      periodStart: new Date("2027-02-01T00:00:00Z"),
      periodEnd: new Date("2027-03-01T00:00:00Z"), // 28 days
      cancelAt: new Date("2027-02-15T00:00:00Z"), // 14 used -> 14 left
    });
    expect(r.totalDays).toBe(28);
    expect(r.remainingDays).toBe(14);
    expect(r.refundMinor).toBe(1400);
  });

  it("clamps a cancellation before the period start to a full refund", () => {
    const r = computeCancellationRefund({
      refundableMinor: 9999,
      periodStart: ps,
      periodEnd: pe,
      cancelAt: new Date("2026-05-20T00:00:00Z"),
    });
    expect(r.refundMinor).toBe(9999);
  });
});
