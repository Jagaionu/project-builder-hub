import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getFraudMetrics, getFraudSettings, updateFraudSettings } from "@/lib/fraud/fraud.functions";
import { DEFAULT_FRAUD_SETTINGS, type FraudSettings } from "@/lib/fraud/fraud-config";

interface Metrics {
  trialsToday: number;
  pendingReviews: number;
  duplicateBlocks: number;
  approved: number;
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
];

function Metric({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={"rounded-xl border p-4 " + (warn && value > 0 ? "border-orange-400/60 bg-orange-500/5" : "border-border bg-surface")}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

export function FraudDashboard() {
  const loadMetrics = useServerFn(getFraudMetrics);
  const loadSettings = useServerFn(getFraudSettings);
  const saveSettings = useServerFn(updateFraudSettings);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [settings, setSettings] = useState<FraudSettings>({ ...DEFAULT_FRAUD_SETTINGS });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([loadMetrics({ data: {} }), loadSettings({ data: {} })]);
    setMetrics(m as Metrics);
    setSettings(s as FraudSettings);
  }, [loadMetrics, loadSettings]);

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
      </div>

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
