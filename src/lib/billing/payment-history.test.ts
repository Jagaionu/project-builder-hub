import { describe, it, expect } from "vitest";
import { buildPaymentHistory, type PaymentInvoiceRow } from "./payment-history";

function inv(partial: Partial<PaymentInvoiceRow>): PaymentInvoiceRow {
  return {
    id: partial.id ?? crypto.randomUUID(),
    ref: partial.ref ?? null,
    status: partial.status ?? "paid",
    currency: partial.currency ?? "GBP",
    net_amount_minor: partial.net_amount_minor ?? 0,
    tax_amount_minor: partial.tax_amount_minor ?? 0,
    fee_amount_minor: partial.fee_amount_minor ?? 0,
    gross_amount_minor: partial.gross_amount_minor ?? 0,
    provider: partial.provider ?? "stripe",
    plan: partial.plan ?? "pro",
    interval: partial.interval ?? "monthly",
    payment_reference: partial.payment_reference ?? null,
    paid_at: partial.paid_at ?? null,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("buildPaymentHistory", () => {
  it("returns empty totals when there are no settled invoices", () => {
    const { entries, summary } = buildPaymentHistory([
      inv({ status: "draft", gross_amount_minor: 5000 }),
      inv({ status: "open", gross_amount_minor: 5000 }),
      inv({ status: "failed", gross_amount_minor: 5000 }),
    ]);
    expect(entries).toHaveLength(0);
    expect(summary.grossPaidMinor).toBe(0);
    expect(summary.lifetimeNetMinor).toBe(0);
    expect(summary.lastPaymentAt).toBeNull();
  });

  it("sums payments and uses paid_at as the timestamp", () => {
    const { entries, summary } = buildPaymentHistory([
      inv({
        status: "paid",
        gross_amount_minor: 12000,
        net_amount_minor: 10000,
        fee_amount_minor: 300,
        paid_at: "2026-02-10T09:00:00.000Z",
      }),
      inv({
        status: "paid",
        gross_amount_minor: 12000,
        fee_amount_minor: 300,
        paid_at: "2026-03-10T09:00:00.000Z",
      }),
    ]);
    expect(entries).toHaveLength(2);
    expect(summary.paymentsCount).toBe(2);
    expect(summary.grossPaidMinor).toBe(24000);
    expect(summary.feesMinor).toBe(600);
    expect(summary.lifetimeNetMinor).toBe(24000);
    expect(summary.firstPaymentAt).toBe("2026-02-10T09:00:00.000Z");
    expect(summary.lastPaymentAt).toBe("2026-03-10T09:00:00.000Z");
  });

  it("treats refunds as negative and nets them out of lifetime value", () => {
    const { summary } = buildPaymentHistory([
      inv({ status: "paid", gross_amount_minor: 12000, paid_at: "2026-02-10T09:00:00.000Z" }),
      inv({
        status: "refunded",
        gross_amount_minor: -6000,
        net_amount_minor: -5000,
        created_at: "2026-02-20T09:00:00.000Z",
      }),
    ]);
    expect(summary.grossPaidMinor).toBe(12000);
    expect(summary.refundedMinor).toBe(6000);
    expect(summary.lifetimeNetMinor).toBe(6000);
    expect(summary.paymentsCount).toBe(1);
    expect(summary.refundsCount).toBe(1);
    // refund does not count as a payment time
    expect(summary.lastPaymentAt).toBe("2026-02-10T09:00:00.000Z");
  });

  it("sorts entries newest-first and flags multi-currency", () => {
    const { entries, summary } = buildPaymentHistory([
      inv({ status: "paid", gross_amount_minor: 100, currency: "GBP", paid_at: "2026-01-05T00:00:00.000Z" }),
      inv({ status: "paid", gross_amount_minor: 200, currency: "EUR", paid_at: "2026-04-05T00:00:00.000Z" }),
      inv({ status: "paid", gross_amount_minor: 300, currency: "GBP", paid_at: "2026-02-05T00:00:00.000Z" }),
    ]);
    expect(entries.map((e) => e.occurredAt)).toEqual([
      "2026-04-05T00:00:00.000Z",
      "2026-02-05T00:00:00.000Z",
      "2026-01-05T00:00:00.000Z",
    ]);
    expect(summary.multiCurrency).toBe(true);
  });
});
