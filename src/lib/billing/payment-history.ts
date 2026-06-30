// Pure read model for a company's payment history (super-admin view).
//
// Everything is sourced from the `invoices` table, which is the convergence
// point for every payment path (Stripe / GoCardless / bank transfer /
// plan-change charges):
//   - a payment  = an invoice with status "paid"     (positive gross_amount_minor)
//   - a refund   = an invoice with status "refunded" (negative gross_amount_minor)
//
// This keeps the history naturally de-duplicated (one settled invoice = one
// entry, so webhook retries never double-count) and needs no backfill. Amounts
// are integer minor units (pence). Refund grosses are already negative in the
// database, so summing all grosses yields the net lifetime value.

export interface PaymentInvoiceRow {
  id: string;
  ref: string | null;
  status: string;
  currency: string;
  net_amount_minor: number;
  tax_amount_minor: number;
  fee_amount_minor: number;
  gross_amount_minor: number;
  provider: string | null;
  plan: string | null;
  interval: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  created_at: string;
}

export type PaymentKind = "payment" | "refund";

export interface PaymentHistoryEntry {
  id: string;
  occurredAt: string; // ISO timestamp the money actually moved
  kind: PaymentKind;
  amountMinor: number; // signed: positive for a payment, negative for a refund
  netMinor: number;
  taxMinor: number;
  feeMinor: number;
  currency: string;
  provider: string | null;
  plan: string | null;
  interval: string | null;
  reference: string | null; // provider payment / refund reference
  invoiceRef: string | null;
}

export interface PaymentHistorySummary {
  currency: string;
  grossPaidMinor: number; // total of all payments (>= 0)
  refundedMinor: number; // total refunded as a positive number (>= 0)
  lifetimeNetMinor: number; // grossPaidMinor - refundedMinor
  feesMinor: number; // provider fees on payments (>= 0)
  paymentsCount: number;
  refundsCount: number;
  firstPaymentAt: string | null;
  lastPaymentAt: string | null;
  multiCurrency: boolean; // true if entries span more than one currency
}

export interface PaymentHistory {
  entries: PaymentHistoryEntry[];
  summary: PaymentHistorySummary;
}

const SETTLED = new Set(["paid", "refunded"]);

// The moment money actually moved: prefer paid_at, fall back to created_at
// (refund credit notes are stamped at creation time and have no paid_at).
function occurredAtOf(row: PaymentInvoiceRow): string {
  return row.paid_at ?? row.created_at;
}

export function buildPaymentHistory(invoices: PaymentInvoiceRow[]): PaymentHistory {
  const entries: PaymentHistoryEntry[] = invoices
    .filter((inv) => SETTLED.has(inv.status))
    .map((inv) => ({
      id: inv.id,
      occurredAt: occurredAtOf(inv),
      kind: inv.status === "refunded" ? ("refund" as const) : ("payment" as const),
      amountMinor: inv.gross_amount_minor,
      netMinor: inv.net_amount_minor,
      taxMinor: inv.tax_amount_minor,
      feeMinor: inv.fee_amount_minor,
      currency: inv.currency,
      provider: inv.provider,
      plan: inv.plan,
      interval: inv.interval,
      reference: inv.payment_reference,
      invoiceRef: inv.ref,
    }))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const payments = entries.filter((e) => e.kind === "payment");
  const refunds = entries.filter((e) => e.kind === "refund");

  const grossPaidMinor = payments.reduce((s, e) => s + e.amountMinor, 0);
  const refundedMinor = refunds.reduce((s, e) => s - e.amountMinor, 0); // refunds are negative
  const feesMinor = payments.reduce((s, e) => s + e.feeMinor, 0);

  const paymentTimes = payments.map((e) => e.occurredAt).sort();
  const currencies = new Set(entries.map((e) => e.currency));

  return {
    entries,
    summary: {
      currency: entries[0]?.currency ?? "GBP",
      grossPaidMinor,
      refundedMinor,
      lifetimeNetMinor: grossPaidMinor - refundedMinor,
      feesMinor,
      paymentsCount: payments.length,
      refundsCount: refunds.length,
      firstPaymentAt: paymentTimes[0] ?? null,
      lastPaymentAt: paymentTimes[paymentTimes.length - 1] ?? null,
      multiCurrency: currencies.size > 1,
    },
  };
}
