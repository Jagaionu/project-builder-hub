/* eslint-disable @typescript-eslint/no-explicit-any -- server-function response shapes are dynamic until db:types is regenerated */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { Company } from "@/lib/types";
import {
  getCompanyBilling,
  getCompanyPaymentHistory,
  setCompanyProvider,
  changeCompanyPlan,
  reconcileBankTransfer,
  saveEmailProviderConfig,
  getEmailProviderConfig,
  listWebhookEvents,
  replayWebhookEvent,
  listPlanPrices,
  setPlanPrice,
  getCompanyAgreements,
  getPlanDefinitions,
  setPlanDefinition,
} from "@/lib/billing/billing.functions";
import type { PaymentHistory } from "@/lib/billing/payment-history";
import { TrialFeeEditor } from "@/components/admin/TrialFeeEditor";
import {
  getPaymentsConfigStatus,
  type PaymentsConfigStatus,
} from "@/lib/billing/config-status.functions";

const fmt = (minor: number | null | undefined, ccy = "GBP") =>
  `${ccy === "GBP" ? "£" : ""}${((minor ?? 0) / 100).toFixed(2)}`;

const newKey = () => crypto.randomUUID();

type Provider = "stripe" | "gocardless" | "bank_transfer";
type Plan = "starter" | "pro" | "enterprise";
type Interval = "monthly" | "annual";

interface Invoice {
  id: string;
  ref: string | null;
  status: string;
  currency: string;
  net_amount_minor: number;
  tax_amount_minor: number;
  fee_amount_minor: number;
  gross_amount_minor: number;
  provider: string;
  plan: string | null;
  interval: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  created_at: string;
}

export function AdminBilling({ companies }: { companies: Company[] }) {
  const [view, setView] = useState<
    "companies" | "plans" | "agreements" | "email" | "webhooks" | "setup"
  >("companies");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["companies", "plans", "agreements", "email", "webhooks", "setup"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={
              "px-3 py-1.5 rounded-md text-xs font-medium border " +
              (view === v
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground")
            }
          >
            {v === "companies"
              ? "Company billing"
              : v === "plans"
                ? "Plan pricing"
                : v === "agreements"
                ? "Agreements"
                : v === "email"
                  ? "Email provider"
                  : v === "webhooks"
                    ? "Webhook log"
                    : "Setup"}
          </button>
        ))}
      </div>
      {view === "companies" && <CompanyBilling companies={companies} />}
      {view === "plans" && (
        <div className="space-y-6">
          <TrialFeeEditor />
          <PlanPricing />
        </div>
      )}
      {view === "agreements" && <AgreementsPanel companies={companies} />}
      {view === "email" && <EmailProviderConfig />}
      {view === "webhooks" && <WebhookLog />}
      {view === "setup" && <PaymentsSetupStatus />}
    </div>
  );
}

function PlanPricing() {
  const listPrices = useServerFn(listPlanPrices);
  const savePrice = useServerFn(setPlanPrice);
  const listDefs = useServerFn(getPlanDefinitions);
  const saveDef = useServerFn(setPlanDefinition);
  const plans: Plan[] = ["starter", "pro", "enterprise"];
  const intervals: Interval[] = ["monthly", "annual"];
  const ALL_MODULES = ["dispatch", "jobs", "drivers", "warehouses", "alerts", "events", "maps", "ai_agent"];

  type Def = { modules: string[]; maxSeats: number; maxDrivers: number; maxWarehouses: number; customBranding: boolean };
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [discount, setDiscount] = useState<Record<string, string>>({});
  const [defs, setDefs] = useState<Record<string, Def>>({});
  const [savingRow, setSavingRow] = useState<string | null>(null);

  // Annual = monthly x 12, minus an optional discount percentage.
  const computeAnnual = (monthlyStr: string, pctStr: string): string => {
    const m = parseFloat(monthlyStr);
    if (!Number.isFinite(m) || m < 0) return "";
    const pct = Math.min(100, Math.max(0, parseFloat(pctStr) || 0));
    return (m * 12 * (1 - pct / 100)).toFixed(2);
  };

  const load = useCallback(async () => {
    const priceRows = (await listPrices({ data: {} })) as Array<{ plan: string; interval: string; net_amount_minor: number }>;
    const pm: Record<string, string> = {};
    for (const r of priceRows) pm[r.plan + "-" + r.interval] = (r.net_amount_minor / 100).toFixed(2);
    const dm: Record<string, string> = {};
    for (const plan of plans) {
      const m = parseFloat(pm[plan + "-monthly"] ?? "");
      const a = parseFloat(pm[plan + "-annual"] ?? "");
      if (Number.isFinite(m) && m > 0 && Number.isFinite(a)) {
        dm[plan] = String(Math.min(100, Math.max(0, Math.round((1 - a / (m * 12)) * 100))));
      } else {
        dm[plan] = "0";
      }
    }
    setPrices(pm);
    setDiscount(dm);
    const defRows = (await listDefs({ data: {} })) as Array<Def & { plan: string }>;
    const dfm: Record<string, Def> = {};
    for (const d of defRows) dfm[d.plan] = { modules: d.modules ?? [], maxSeats: d.maxSeats ?? 0, maxDrivers: d.maxDrivers ?? 0, maxWarehouses: d.maxWarehouses ?? 0, customBranding: Boolean(d.customBranding) };
    setDefs(dfm);
  }, [listPrices, listDefs]);
  useEffect(() => { void load(); }, [load]);

  const onMonthly = (plan: string, val: string) =>
    setPrices((p) => ({ ...p, [plan + "-monthly"]: val, [plan + "-annual"]: computeAnnual(val, discount[plan] ?? "0") }));
  const onDiscount = (plan: string, val: string) => {
    setDiscount((d) => ({ ...d, [plan]: val }));
    setPrices((p) => ({ ...p, [plan + "-annual"]: computeAnnual(p[plan + "-monthly"] ?? "", val) }));
  };

  const emptyDef: Def = { modules: [], maxSeats: 0, maxDrivers: 0, maxWarehouses: 0, customBranding: false };
  const setDef = (plan: string, patch: Partial<Def>) =>
    setDefs((p) => ({ ...p, [plan]: { ...(p[plan] ?? emptyDef), ...patch } }));
  const toggleModule = (plan: string, m: string) => {
    const cur = defs[plan]?.modules ?? [];
    setDef(plan, { modules: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] });
  };

  const onSave = async (plan: Plan) => {
    setSavingRow(plan);
    try {
      for (const interval of intervals) {
        const raw = prices[plan + "-" + interval];
        if (raw == null || raw === "") continue;
        const v = parseFloat(raw);
        if (!Number.isFinite(v) || v < 0) { toast.error("Invalid " + plan + " " + interval + " price"); continue; }
        await savePrice({ data: { plan, interval, netMinor: Math.round(v * 100) } });
      }
      const d = defs[plan];
      if (d) {
        await saveDef({ data: { plan, modules: d.modules, maxSeats: Number(d.maxSeats) || 0, maxDrivers: Number(d.maxDrivers) || 0, maxWarehouses: Number(d.maxWarehouses) || 0, customBranding: Boolean(d.customBranding) } });
      }
      toast.success(plan + " plan saved");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save plan");
    } finally {
      setSavingRow(null);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-xs text-muted-foreground">
        Control each plan option and price from here. Enter the monthly price; the annual is calculated as monthly x 12 minus the discount you set. Net prices exclude VAT; a per-company price override (Companies tab) still takes precedence.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {plans.map((plan) => {
          const d = defs[plan] ?? emptyDef;
          const annual = prices[plan + "-annual"];
          const pct = Number(discount[plan]) || 0;
          return (
            <div key={plan} className="rounded-xl border border-border bg-surface p-4 space-y-3">
              <div className="text-sm font-semibold capitalize">{plan}</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">Monthly £ (net)</span>
                  <input type="number" step="0.01" min="0" value={prices[plan + "-monthly"] ?? ""} onChange={(e) => onMonthly(plan, e.target.value)} placeholder="—" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                </label>
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">Annual discount %</span>
                  <input type="number" step="1" min="0" max="100" value={discount[plan] ?? "0"} onChange={(e) => onDiscount(plan, e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                </label>
              </div>
              <div className="rounded-md bg-surface-2/40 px-2 py-1.5 text-[11px] text-muted-foreground">
                Annual (auto): <b className="text-foreground tabular-nums">{annual ? "£" + annual : "—"}</b> per year
                {annual && pct > 0 ? " (" + pct + "% off)" : ""}
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Modules</div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_MODULES.map((m) => {
                    const on = (d.modules ?? []).includes(m);
                    return (
                      <button key={m} type="button" onClick={() => toggleModule(plan, m)} className={"px-2 py-1 rounded text-[11px] border " + (on ? "bg-primary/10 text-primary border-primary/30" : "border-border/50 text-muted-foreground/60")}>{m}</button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block"><span className="text-[10px] text-muted-foreground">Seats</span><input type="number" min="0" value={d.maxSeats} onChange={(e) => setDef(plan, { maxSeats: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" /></label>
                <label className="block"><span className="text-[10px] text-muted-foreground">Drivers</span><input type="number" min="0" value={d.maxDrivers} onChange={(e) => setDef(plan, { maxDrivers: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" /></label>
                <label className="block"><span className="text-[10px] text-muted-foreground">Warehouses</span><input type="number" min="0" value={d.maxWarehouses} onChange={(e) => setDef(plan, { maxWarehouses: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" /></label>
              </div>
              <p className="text-[10px] text-muted-foreground">0 = unlimited for drivers and warehouses.</p>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={Boolean(d.customBranding)} onChange={(e) => setDef(plan, { customBranding: e.target.checked })} />
                Custom branding
              </label>
              <button onClick={() => onSave(plan)} disabled={savingRow === plan} className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {savingRow === plan ? "Saving…" : "Save plan"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompanyBilling({ companies }: { companies: Company[] }) {
  const [selectedId, setSelectedId] = useState<string>(companies[0]?.id ?? "");
  const fetchBilling = useServerFn(getCompanyBilling);
  const fetchHistory = useServerFn(getCompanyPaymentHistory);
  const setProvider = useServerFn(setCompanyProvider);
  const changePlan = useServerFn(changeCompanyPlan);
  const reconcile = useServerFn(reconcileBankTransfer);

  const [data, setData] = useState<{ company: any; invoices: Invoice[]; methods: any[] } | null>(
    null,
  );
  const [history, setHistory] = useState<PaymentHistory | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const [res, hist] = await Promise.all([
        fetchBilling({ data: { companyId: selectedId } }),
        fetchHistory({ data: { companyId: selectedId } }),
      ]);
      setData(res as any);
      setHistory(hist as PaymentHistory);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [selectedId, fetchBilling, fetchHistory]);
  useEffect(() => {
    void load();
  }, [load]);

  const kpis = useMemo(() => {
    const inv = data?.invoices ?? [];
    const paid = inv.filter((i) => i.status === "paid");
    const overdue = inv.filter((i) => i.status === "open");
    const mrr = paid
      .filter((i) => i.interval === "monthly")
      .reduce((s, i) => s + i.net_amount_minor, 0);
    const fees = paid.reduce((s, i) => s + i.fee_amount_minor, 0);
    return {
      mrr,
      fees,
      overdue: overdue.length,
      failed: inv.filter((i) => i.status === "failed").length,
    };
  }, [data]);

  const onSetProvider = async (provider: Provider) => {
    try {
      await setProvider({ data: { companyId: selectedId, provider, idempotencyKey: newKey() } });
      toast.success(`Provider set to ${provider}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onChangePlan = async (toPlan: Plan, interval: Interval, behavior: string) => {
    try {
      const res: any = await changePlan({
        data: {
          companyId: selectedId,
          toPlan,
          interval,
          behavior: behavior as any,
          idempotencyKey: newKey(),
        },
      });
      toast.success(
        `Plan changed to ${toPlan}` +
          (res?.proration?.amountMinor ? ` (proration ${fmt(res.proration.amountMinor)})` : ""),
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onReconcile = async (inv: Invoice) => {
    const ref = window.prompt("Bank statement reference (required for audit):");
    if (!ref) return;
    try {
      await reconcile({
        data: {
          invoiceId: inv.id,
          bankStatementReference: ref,
          matchedAmountMinor: inv.gross_amount_minor,
        },
      });
      toast.success(`Invoice ${inv.ref} reconciled`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Kpi label="MRR (net)" value={fmt(kpis.mrr)} />
        <Kpi label="Fees collected" value={fmt(kpis.fees)} />
        <Kpi label="Open invoices" value={String(kpis.overdue)} />
        <Kpi label="Failed" value={String(kpis.failed)} />
      </div>

      {data?.company && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>
              <span className="text-muted-foreground">Plan:</span> <b>{data.company.plan}</b>
            </span>
            <span>
              <span className="text-muted-foreground">Status:</span>{" "}
              <b>{data.company.subscription_status}</b>
            </span>
            <span>
              <span className="text-muted-foreground">Provider:</span>{" "}
              <b>{data.company.billing_provider ?? "—"}</b>
            </span>
            <span>
              <span className="text-muted-foreground">VAT:</span>{" "}
              <b>{data.company.vat_number ?? "—"}</b> ({data.company.country_code})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Set provider:</span>
            {(["stripe", "gocardless", "bank_transfer"] as Provider[]).map((p) => (
              <button
                key={p}
                onClick={() => onSetProvider(p)}
                className="px-2.5 py-1 rounded border border-border text-xs hover:bg-surface-2"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Change plan (monthly):</span>
            {(["starter", "pro", "enterprise"] as Plan[]).map((p) => (
              <button
                key={p}
                onClick={() => onChangePlan(p, "monthly", "immediate_charge")}
                className="px-2.5 py-1 rounded border border-border text-xs hover:bg-surface-2"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Invoice</th>
              <th className="px-3 py-2 text-left">Provider</th>
              <th className="px-3 py-2 text-right">Net</th>
              <th className="px-3 py-2 text-right">VAT</th>
              <th className="px-3 py-2 text-right">Fee</th>
              <th className="px-3 py-2 text-right">Gross</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(data?.invoices ?? []).map((i) => (
              <tr key={i.id} className="hover:bg-surface-2/40">
                <td className="px-3 py-2 font-mono text-[11px]">{i.ref}</td>
                <td className="px-3 py-2 text-xs">{i.provider}</td>
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
                <td className="px-3 py-2">
                  {i.provider === "bank_transfer" && i.status === "open" && (
                    <button
                      onClick={() => onReconcile(i)}
                      className="text-xs underline text-primary"
                    >
                      Reconcile
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {(data?.invoices ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No invoices
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {history && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Payment history</h3>
            {history.summary.multiCurrency && (
              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Mixed currencies — totals may not sum
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Kpi
              label="Lifetime paid (net)"
              value={fmt(history.summary.lifetimeNetMinor, history.summary.currency)}
            />
            <Kpi label="Payments" value={String(history.summary.paymentsCount)} />
            <Kpi
              label="Refunded"
              value={fmt(history.summary.refundedMinor, history.summary.currency)}
            />
            <Kpi
              label="Last payment"
              value={
                history.summary.lastPaymentAt
                  ? new Date(history.summary.lastPaymentAt).toLocaleDateString()
                  : "—"
              }
            />
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Date / time</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Method</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.entries.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-2/40">
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {new Date(e.occurredAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium " +
                          (e.kind === "refund"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")
                        }
                      >
                        {e.kind === "refund" ? "Refund" : "Payment"}
                      </span>
                    </td>
                    <td
                      className={
                        "px-3 py-2 text-right tabular-nums font-semibold " +
                        (e.amountMinor < 0 ? "text-amber-600 dark:text-amber-400" : "")
                      }
                    >
                      {fmt(e.amountMinor, e.currency)}
                    </td>
                    <td className="px-3 py-2 text-xs">{e.provider ?? "—"}</td>
                    <td className="px-3 py-2 text-xs capitalize">
                      {e.plan ?? "—"}
                      {e.interval ? ` / ${e.interval}` : ""}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground max-w-[160px] truncate">
                      {e.reference ?? e.invoiceRef ?? "—"}
                    </td>
                  </tr>
                ))}
                {history.entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">
                      No payments yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AgreementsPanel({ companies }: { companies: Company[] }) {
  const [selectedId, setSelectedId] = useState<string>(companies[0]?.id ?? "");
  const fetchAgreements = useServerFn(getCompanyAgreements);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewText, setViewText] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const r = (await fetchAgreements({ data: { companyId: selectedId } })) as any[];
      setRows(r ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load agreements");
    } finally {
      setLoading(false);
    }
  }, [selectedId, fetchAgreements]);
  useEffect(() => {
    void load();
  }, [load]);

  const download = (row: any) => {
    const blob = new Blob([String(row.document_snapshot ?? "")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agreement-" + String(row.id ?? "record") + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-sm">
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Accepted</th>
              <th className="px-3 py-2 text-left">By</th>
              <th className="px-3 py-2 text-left">Version</th>
              <th className="px-3 py-2 text-left">Plan</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-left">Guarantee</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2/40 align-top">
                <td className="px-3 py-2 text-xs whitespace-nowrap">{r.accepted_at ? new Date(r.accepted_at).toLocaleString() : "—"}</td>
                <td className="px-3 py-2 text-xs">
                  <div>{r.accepted_by_name ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground">{r.accepted_by_email ?? ""} {r.accepted_by_role ? "(" + r.accepted_by_role + ")" : ""}</div>
                </td>
                <td className="px-3 py-2 text-xs font-mono">{r.agreement_version}</td>
                <td className="px-3 py-2 text-xs capitalize">{r.plan ?? "—"}{r.interval ? " / " + r.interval : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(r.price_gross_minor, r.currency)}</td>
                <td className="px-3 py-2 text-xs">{r.personal_guarantee ? (r.guarantor_name ?? "Yes") : "No"}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <button onClick={() => setViewText(String(r.document_snapshot ?? ""))} className="underline text-primary mr-2">View</button>
                  <button onClick={() => download(r)} className="underline text-primary">Download</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">No agreements recorded</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {viewText !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setViewText(null)}>
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-border bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Accepted agreement</h3>
              <button onClick={() => setViewText(null)} className="text-muted-foreground hover:text-foreground text-xs">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-background p-3 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">{viewText}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailProviderConfig() {
  const fetchCfg = useServerFn(getEmailProviderConfig);
  const saveCfg = useServerFn(saveEmailProviderConfig);
  const [provider, setProvider] = useState<"resend" | "postmark" | "ses">("resend");
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const c: any = await fetchCfg({ data: {} });
        if (c?.configured) {
          setProvider(c.provider);
          setFromEmail(c.fromEmail ?? "");
          setFromName(c.fromName ?? "");
          setReplyTo(c.replyTo ?? "");
          setApiKeySet(Boolean(c.apiKeySet));
        }
      } catch {
        /* not configured yet */
      }
    })();
  }, [fetchCfg]);

  const save = async () => {
    try {
      await saveCfg({
        data: {
          provider,
          apiKey: apiKey || undefined,
          fromEmail,
          fromName: fromName || undefined,
          replyTo: replyTo || undefined,
        },
      });
      toast.success("Email provider saved");
      setApiKey("");
      setApiKeySet(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="max-w-lg rounded-lg border border-border bg-surface p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        Used for dunning / failed-payment emails. The API key is stored server-side and never
        returned.
      </p>
      <Field label="Provider">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as any)}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="resend">Resend</option>
          <option value="postmark">Postmark</option>
          <option value="ses">Amazon SES</option>
        </select>
      </Field>
      <Field label={`API key ${apiKeySet ? "(set — leave blank to keep)" : ""}`}>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={apiKeySet ? "••••••••" : "Provider API key"}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        />
      </Field>
      <Field label="From email">
        <input
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="billing@yourcompany.com"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        />
      </Field>
      <Field label="From name">
        <input
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
          placeholder="Your Company Billing"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        />
      </Field>
      <Field label="Reply-to (optional)">
        <input
          value={replyTo}
          onChange={(e) => setReplyTo(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        />
      </Field>
      <button
        onClick={save}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Save
      </button>
    </div>
  );
}

function WebhookLog() {
  const fetchEvents = useServerFn(listWebhookEvents);
  const replay = useServerFn(replayWebhookEvent);
  const [rows, setRows] = useState<any[]>([]);
  const [onlyPending, setOnlyPending] = useState(false);

  const load = useCallback(async () => {
    const res: any = await fetchEvents({ data: { onlyPending } });
    setRows(res ?? []);
  }, [fetchEvents, onlyPending]);
  useEffect(() => {
    void load();
  }, [load]);

  const onReplay = async (id: string) => {
    try {
      await replay({ data: { id } });
      toast.success("Replayed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Replay failed");
    }
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={onlyPending}
          onChange={(e) => setOnlyPending(e.target.checked)}
        />{" "}
        Show only unprocessed
      </label>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Provider</th>
              <th className="px-3 py-2 text-left">Event</th>
              <th className="px-3 py-2 text-left">Received</th>
              <th className="px-3 py-2 text-left">Processed</th>
              <th className="px-3 py-2 text-left">Error</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2/40">
                <td className="px-3 py-2 text-xs">{r.provider}</td>
                <td className="px-3 py-2 font-mono text-[11px]">{r.event_id ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{new Date(r.received_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs">
                  {r.processed_at ? (
                    new Date(r.processed_at).toLocaleString()
                  ) : (
                    <span className="text-warning">pending</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-destructive max-w-[200px] truncate">
                  {r.error ?? ""}
                </td>
                <td className="px-3 py-2">
                  {!r.processed_at && (
                    <button
                      onClick={() => onReplay(r.id)}
                      className="text-xs underline text-primary"
                    >
                      Replay
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No webhook events
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-semibold mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function PaymentsSetupStatus() {
  const fetchStatus = useServerFn(getPaymentsConfigStatus);
  const [s, setS] = useState<PaymentsConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchStatus()
      .then((r) => setS(r as PaymentsConfigStatus))
      .catch(() => setS(null))
      .finally(() => setLoading(false));
  }, [fetchStatus]);

  if (loading) return <div className="text-xs text-muted-foreground">Checking configuration…</div>;
  if (!s) return <div className="text-xs text-destructive">Could not load configuration.</div>;

  const Row = ({ label, ok, note }: { label: string; ok: boolean; note?: string }) => (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 last:border-0">
      <div>
        <div className="text-sm text-foreground">{label}</div>
        {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
      </div>
      <span
        className={
          "text-xs font-semibold " +
          (ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")
        }
      >
        {ok ? "Configured" : "Not set"}
      </span>
    </div>
  );

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-xs text-muted-foreground">
        Read-only check of the platform payment and push settings (values are never shown). Set
        these as environment variables in your host.
      </p>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-3 py-2 bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Stripe
        </div>
        <Row label="Secret key (STRIPE_SECRET_KEY)" ok={s.stripe.secretKey} />
        <Row label="Webhook secret (STRIPE_WEBHOOK_SECRET)" ok={s.stripe.webhookSecret} />
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-3 py-2 bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          GoCardless
        </div>
        <Row label="Access token (GOCARDLESS_ACCESS_TOKEN)" ok={s.gocardless.accessToken} />
        <Row label="Webhook secret (GOCARDLESS_WEBHOOK_SECRET)" ok={s.gocardless.webhookSecret} />
        <Row
          label="Environment (GOCARDLESS_ENVIRONMENT)"
          ok={!!s.gocardless.environment}
          note={s.gocardless.environment ?? "not set"}
        />
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-3 py-2 bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          General and push
        </div>
        <Row label="App base URL (APP_BASE_URL)" ok={s.appBaseUrl} />
        <Row label="Push public key (VAPID_PUBLIC_KEY)" ok={s.push.publicKey} />
        <Row label="Push private key (VAPID_PRIVATE_KEY)" ok={s.push.privateKey} />
      </div>
    </div>
  );
}
