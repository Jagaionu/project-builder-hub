/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getFraudMetrics,
  getFraudSettings,
  updateFraudSettings,
  listSignupReviews,
  approveSignup,
  rejectSignup,
  grantNewTrial,
} from "@/lib/fraud/fraud.functions";
import { DEFAULT_FRAUD_SETTINGS, type FraudSettings } from "@/lib/fraud/fraud-config";

interface Metrics {
  trialsToday: number;
  pendingReviews: number;
  duplicateBlocks: number;
  approved: number;
  falsePositives: number;
  chVerifiedRate: number;
  avgReviewMinutes: number;
}

interface PendingItem {
  companyId: string;
  name: string;
  companyNumber: string | null;
  verificationMethod: string | null;
  createdAt: string;
  email: string | null;
  identityTrust: number | null;
  fraudRisk: number | null;
  reasons: string[];
  decisionLog: Array<{ step: string; detail: any; created_at: string }>;
}

interface BlockedItem {
  signupId: string;
  companyName: string | null;
  companyNumber: string | null;
  email: string | null;
  identityTrust: number | null;
  fraudRisk: number | null;
  reasons: string[];
  createdAt: string;
}

const GROUPS: Array<{ title: string; fields: Array<[keyof FraudSettings, string]> }> = [
  {
    title: "Thresholds",
    fields: [
      ["riskThreshold", "Risk threshold (>= sends to review)"],
      ["trustMin", "Min identity trust to auto-approve"],
      ["cooldownMonths", "Company cooldown (months)"],
    ],
  },
  {
    title: "Rate limit",
    fields: [
      ["rateLimitMaxAttempts", "Max attempts"],
      ["rateLimitWindowMinutes", "Window (minutes)"],
    ],
  },
  {
    title: "Identity trust weights",
    fields: [
      ["weightIdentityCh", "Companies House verified"],
      ["weightIdentityManual", "Manual verification"],
      ["weightIdentityBusinessEmail", "Business email"],
      ["weightIdentityDirector", "Director name provided"],
    ],
  },
  {
    title: "Fraud risk weights",
    fields: [
      ["weightRiskDevice", "Same device seen before"],
      ["weightRiskIp", "Same IP seen before"],
      ["weightRiskFreeEmail", "Free email provider"],
      ["weightRiskDisposableEmail", "Disposable email"],
      ["weightRiskFailedSignups", "Repeated failed signups"],
    ],
  },
  {
    title: "Trusted status",
    fields: [
      ["trustedMinPaidInvoices", "Min paid invoices"],
      ["trustedMinActiveDays", "Min active days"],
    ],
  },
  {
    title: "Behaviour (active trials, 24h)",
    fields: [
      ["behaviourMaxDevices24h", "Max devices"],
      ["behaviourMaxCountries24h", "Max countries"],
      ["behaviourMaxJobs24h", "Max jobs created"],
      ["behaviourMaxDrivers24h", "Max drivers added"],
    ],
  },
];

function Metric({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={"rounded-xl border p-4 " + (warn && value > 0 ? "border-orange-400/60 bg-orange-500/5" : "border-border bg-surface")}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function MetricText({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function Scores({ trust, risk }: { trust: number | null; risk: number | null }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="rounded bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5">trust {trust ?? "-"}</span>
      <span className="rounded bg-orange-500/10 text-orange-600 px-1.5 py-0.5">risk {risk ?? "-"}</span>
    </div>
  );
}

export function FraudDashboard() {
  const loadMetrics = useServerFn(getFraudMetrics);
  const loadSettings = useServerFn(getFraudSettings);
  const saveSettings = useServerFn(updateFraudSettings);
  const loadReviews = useServerFn(listSignupReviews);
  const approve = useServerFn(approveSignup);
  const reject = useServerFn(rejectSignup);
  const grant = useServerFn(grantNewTrial);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [settings, setSettings] = useState<FraudSettings>({ ...DEFAULT_FRAUD_SETTINGS });
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [blocked, setBlocked] = useState<BlockedItem[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, s, r] = await Promise.all([
      loadMetrics({ data: {} }),
      loadSettings({ data: {} }),
      loadReviews({ data: {} }),
    ]);
    setMetrics(m as Metrics);
    setSettings(s as FraudSettings);
    const rv = r as { pending: PendingItem[]; blocked: BlockedItem[] };
    setPending(rv.pending);
    setBlocked(rv.blocked);
  }, [loadMetrics, loadSettings, loadReviews]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async () => {
    setSaving(true);
    try {
      const updated = (await saveSettings({ data: settings })) as FraudSettings;
      setSettings(updated);
      toast.success("Fraud settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const setField = (k: keyof FraudSettings, v: string) =>
    setSettings((s) => ({ ...s, [k]: v === "" ? 0 : Number(v) }));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3">Signups</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Trials started today" value={metrics?.trialsToday ?? 0} />
          <Metric label="Pending review" value={metrics?.pendingReviews ?? 0} warn />
          <Metric label="Duplicate / blocked" value={metrics?.duplicateBlocks ?? 0} />
          <Metric label="Approved" value={metrics?.approved ?? 0} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          <Metric label="False positives (flagged then approved)" value={metrics?.falsePositives ?? 0} />
          <MetricText label="Companies House verified" value={(metrics?.chVerifiedRate ?? 0) + "%"} />
          <MetricText label="Avg review time" value={(metrics?.avgReviewMinutes ?? 0) + " min"} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <h3 className="text-sm font-semibold">Pending review ({pending.length})</h3>
        {pending.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing awaiting review.</p>
        ) : (
          <div className="divide-y divide-border">
            {pending.map((p) => (
              <div key={p.companyId} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {p.email ?? "-"} - {p.verificationMethod === "companies_house" ? "CH " + (p.companyNumber ?? "") : "manual"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Scores trust={p.identityTrust} risk={p.fraudRisk} />
                    <button onClick={() => setExpanded(expanded === p.companyId ? null : p.companyId)} className="text-[11px] text-muted-foreground hover:text-foreground underline">
                      {expanded === p.companyId ? "Hide" : "Details"}
                    </button>
                    <button
                      disabled={busyId === p.companyId}
                      onClick={() => act(p.companyId, () => approve({ data: { companyId: p.companyId } }), "Trial approved")}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      Approve trial
                    </button>
                    <button
                      disabled={busyId === p.companyId}
                      onClick={() => act(p.companyId, () => reject({ data: { companyId: p.companyId } }), "Signup rejected")}
                      className="rounded-md border border-destructive/50 text-destructive px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                {expanded === p.companyId && (
                  <div className="mt-2 rounded-lg bg-background border border-border p-3 text-[11px] space-y-1">
                    <div>Reasons: {p.reasons.length ? p.reasons.join(", ") : "none"}</div>
                    <div className="text-muted-foreground">Decision log:</div>
                    {p.decisionLog.map((l, i) => (
                      <div key={i} className="font-mono text-[10px] text-muted-foreground">
                        {new Date(l.created_at).toLocaleString()} - {l.step} - {JSON.stringify(l.detail)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {blocked.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <h3 className="text-sm font-semibold">Recently blocked (returning within cooldown)</h3>
          <div className="divide-y divide-border">
            {blocked.map((b) => (
              <div key={b.signupId} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{b.companyName ?? "-"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {b.email ?? "-"} - {b.companyNumber ?? "-"} - {b.reasons.join(", ")}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Scores trust={b.identityTrust} risk={b.fraudRisk} />
                  <button
                    disabled={busyId === b.signupId}
                    onClick={() => act(b.signupId, () => grant({ data: { signupId: b.signupId } }), "New trial granted - they can sign up again")}
                    className="rounded-md border border-primary/50 text-primary px-3 py-1.5 text-xs font-semibold hover:bg-primary/10 disabled:opacity-50"
                  >
                    Grant new trial
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Detection settings</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tunable live - changes take effect on the next signup, no deploy needed.
            </p>
          </div>
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</div>
              {g.fields.map(([k, label]) => (
                <label key={k} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <input
                    type="number"
                    value={settings[k]}
                    onChange={(e) => setField(k, e.target.value)}
                    className="w-24 h-8 px-2 rounded-md border border-border bg-background text-sm text-right"
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
