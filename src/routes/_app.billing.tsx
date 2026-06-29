/* eslint-disable @typescript-eslint/no-explicit-any -- server-function response shapes are dynamic until db:types is regenerated */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "./_app.index";
import {
  getMyBilling,
  startCheckout,
  previewCancellation,
  cancelSubscription,
} from "@/lib/billing/billing.functions";
import { useTenant } from "@/lib/tenant-context";
import { CreditCard, Building2, Banknote } from "lucide-react";

export const Route = createFileRoute("/_app/billing")({
  component: BillingPage,
  head: () => ({ meta: [{ title: "Billing — Planning System" }] }),
});

const fmt = (minor: number | null | undefined, ccy = "GBP") =>
  `${ccy === "GBP" ? "£" : ""}${((minor ?? 0) / 100).toFixed(2)}`;
const newKey = () => crypto.randomUUID();

type Provider = "stripe" | "gocardless" | "bank_transfer";

const PROVIDERS: { id: Provider; label: string; desc: string; Icon: React.ElementType }[] = [
  {
    id: "stripe",
    label: "Card (Stripe)",
    desc: "Pay by card. Fees included in the total.",
    Icon: CreditCard,
  },
  {
    id: "gocardless",
    label: "Direct Debit (GoCardless)",
    desc: "Lower fees. Authorise a Direct Debit mandate once.",
    Icon: Building2,
  },
  {
    id: "bank_transfer",
    label: "Bank transfer",
    desc: "Pay by bank transfer using your invoice reference.",
    Icon: Banknote,
  },
];

interface Invoice {
  id: string;
  ref: string | null;
  status: string;
  currency: string;
  net_amount_minor: number;
  tax_amount_minor: number;
  fee_amount_minor: number;
  gross_amount_minor: number;
  plan: string | null;
  interval: string | null;
  paid_at: string | null;
  created_at: string;
}

function isBlocked(c?: {
  subscription_status?: string | null;
  subscription_ends_at?: string | null;
} | null): boolean {
  if (!c) return false;
  const s = c.subscription_status;
  if (s === "suspended" || s === "cancelled") return true;
  if (s === "trial" && c.subscription_ends_at && new Date(c.subscription_ends_at) < new Date())
    return true;
  return false;
}

function GatedBanner({ status, isAdmin }: { status?: string | null; isAdmin: boolean }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <div className="font-semibold text-amber-700 dark:text-amber-400">Access paused</div>
      <p className="mt-1 text-muted-foreground">
        {status === "trial" ? "Your free trial has ended." : "Your subscription is not active."}{" "}
        {isAdmin
          ? "Complete payment below to restore full access to the app."
          : "Please ask your company admin to complete payment to restore access."}
      </p>
    </div>
  );
}

function BillingPage() {
  const { role, isSuperAdmin, company: ctxCompany } = useTenant();
  const isAdmin = role === "admin" || isSuperAdmin;
  const navigate = useNavigate();
  const gated = isBlocked(ctxCompany);
  // Billing is admin-only when healthy; when the account is gated, everyone
  // sent here sees why (avoids a redirect loop with the _app billing gate).
  useEffect(() => {
    if (!isAdmin && !gated) navigate({ to: "/", replace: true });
  }, [isAdmin, gated, navigate]);
  const fetchBilling = useServerFn(getMyBilling);
  const checkout = useServerFn(startCheckout);
  const previewCancel = useServerFn(previewCancellation);
  const cancelSub = useServerFn(cancelSubscription);
  const [cancelStep, setCancelStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [preview, setPreview] = useState<{
    eligible: boolean;
    refundMinor: number;
    remainingDays: number;
    currency: string;
  } | null>(null);

  const openCancel = async () => {
    setCancelStep("confirm");
    try {
      const p: any = await previewCancel({ data: {} });
      setPreview(p);
    } catch {
      setPreview(null);
    }
  };
  const doCancel = async () => {
    setCancelStep("busy");
    try {
      await cancelSub({ data: { idempotencyKey: newKey() } });
      toast.success("Subscription cancelled");
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
      setCancelStep("confirm");
    }
  };
  const [data, setData] = useState<{ company: any; invoices: Invoice[]; methods: any[] } | null>(
    null,
  );
  const [busy, setBusy] = useState<Provider | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchBilling({ data: {} });
      setData(res as any);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load billing");
    }
  }, [fetchBilling]);
  useEffect(() => {
    void load();
  }, [load]);

  const company = data?.company;
  const plan = company?.plan ?? "starter";

  const onCheckout = async (provider: Provider) => {
    setBusy(provider);
    try {
      const origin = window.location.origin;
      const res: any = await checkout({
        data: {
          plan,
          interval: "monthly",
          provider,
          successUrl: `${origin}/billing?status=success`,
          cancelUrl: `${origin}/billing?status=cancelled`,
          idempotencyKey: newKey(),
        },
      });
      if (res?.redirectUrl) window.location.href = res.redirectUrl;
      else {
        toast.success("Invoice created");
        await load();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(null);
    }
  };

  const openInvoice = data?.invoices?.find((i) => i.status === "open");

  if (!isAdmin && !gated) return null;

  if (gated && !isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Billing" subtitle="Subscription status" />
        <GatedBanner status={ctxCompany?.subscription_status} isAdmin={false} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle="Manage your subscription and payment method" />

      {gated && <GatedBanner status={ctxCompany?.subscription_status} isAdmin />}

      {/* Current plan / status */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Plan</div>
            <div className="text-lg font-semibold">{plan}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Status
            </div>
            <div className="text-lg font-semibold">{company?.subscription_status ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Renews
            </div>
            <div className="text-lg font-semibold">
              {company?.current_period_end
                ? new Date(company.current_period_end).toLocaleDateString()
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Method
            </div>
            <div className="text-lg font-semibold">{company?.billing_provider ?? "Not set"}</div>
          </div>
        </div>
      </div>

      {/* Provider selection / checkout */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Choose how to pay</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Processing fees are included in the total shown at checkout (you are contracting as a
          business customer).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => onCheckout(p.id)}
              disabled={busy !== null}
              className="text-left rounded-lg border border-border bg-surface p-4 hover:border-primary transition-colors disabled:opacity-60"
            >
              <p.Icon className="size-5 mb-2 text-primary" />
              <div className="font-medium text-sm">{p.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{p.desc}</div>
              {busy === p.id && <div className="text-xs text-muted-foreground mt-2">Starting…</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Bank transfer instructions when an open bank-transfer invoice exists */}
      {openInvoice && company?.billing_provider === "bank_transfer" && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <h2 className="font-semibold mb-2">Bank transfer instructions</h2>
          <p className="text-muted-foreground mb-2">
            Please transfer <b>{fmt(openInvoice.gross_amount_minor, openInvoice.currency)}</b> and
            quote invoice reference <b>{openInvoice.ref}</b> so we can match your payment.
          </p>
        </div>
      )}

      {/* Cancel subscription */}
      {isAdmin && !gated && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h2 className="text-sm font-semibold mb-1">Cancel subscription</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Cancelling ends access immediately and refunds the unused portion of your current
            month. Processing fees are non-refundable.
          </p>
          {cancelStep === "idle" ? (
            <button
              onClick={openCancel}
              className="rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors"
            >
              Cancel subscription
            </button>
          ) : (
            <div className="space-y-3">
              <div className="text-sm">
                {preview?.eligible ? (
                  <>
                    Estimated refund:{" "}
                    <b>{fmt(preview.refundMinor, preview.currency)}</b> for {preview.remainingDays}{" "}
                    unused day(s).
                  </>
                ) : (
                  <>No refund is due (no paid period remaining).</>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  disabled={cancelStep === "busy"}
                  onClick={doCancel}
                  className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {cancelStep === "busy" ? "Cancelling…" : "Confirm cancellation"}
                </button>
                <button
                  disabled={cancelStep === "busy"}
                  onClick={() => setCancelStep("idle")}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface transition-colors"
                >
                  Keep subscription
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Invoices */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Invoices</h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Invoice</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Plan</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-3 py-2 text-right">VAT</th>
                <th className="px-3 py-2 text-right">Fee</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(data?.invoices ?? []).map((i) => (
                <tr key={i.id} className="hover:bg-surface-2/40">
                  <td className="px-3 py-2 font-mono text-[11px]">{i.ref}</td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(i.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-xs">{i.plan ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(i.net_amount_minor, i.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(i.tax_amount_minor, i.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(i.fee_amount_minor, i.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {fmt(i.gross_amount_minor, i.currency)}
                  </td>
                  <td className="px-3 py-2 text-xs">{i.status}</td>
                </tr>
              ))}
              {(data?.invoices ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No invoices yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
