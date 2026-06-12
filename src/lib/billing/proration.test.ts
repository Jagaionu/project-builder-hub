import { describe, it, expect } from "vitest";
import { computeProration } from "./proration";

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
