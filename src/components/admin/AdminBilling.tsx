/* eslint-disable @typescript-eslint/no-explicit-any -- server-function response shapes are dynamic until db:types is regenerated */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { Company } from "@/lib/types";
import {
  getCompanyBilling,
  setCompanyProvider,
  changeCompanyPlan,
  reconcileBankTransfer,
  saveEmailProviderConfig,
  getEmailProviderConfig,
  listWebhookEvents,
  replayWebhookEvent,
} from "@/lib/billing/billing.functions";

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
  const [view, setView] = useState<"companies" | "email" | "webhooks">("companies");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["companies", "email", "webhooks"] as const).map((v) => (
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
              : v === "email"
                ? "Email provider"
                : "Webhook log"}
          </button>
        ))}
      </div>
      {view === "companies" && <CompanyBilling companies={companies} />}
      {view === "email" && <EmailProviderConfig />}
      {view === "webhooks" && <WebhookLog />}
    </div>
  );
}

function CompanyBilling({ companies }: { companies: Company[] }) {
  const [selectedId, setSelectedId] = useState<string>(companies[0]?.id ?? "");
  const fetchBilling = useServerFn(getCompanyBilling);
  const setProvider = useServerFn(setCompanyProvider);
  const changePlan = useServerFn(changeCompanyPlan);
  const reconcile = useServerFn(reconcileBankTransfer);

  const [data, setData] = useState<{ company: any; invoices: Invoice[]; methods: any[] } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const res = await fetchBilling({ data: { companyId: selectedId } });
      setData(res as any);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [selectedId, fetchBilling]);
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
