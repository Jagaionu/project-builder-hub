import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getTrialConfig, updateTrialConfig } from "@/lib/pricing/trial-config.functions";
import { DEFAULT_TRIAL_CONFIG, type TrialConfig } from "@/lib/pricing/trial-config";

const toPounds = (minor: number) => (minor / 100).toFixed(2);
const toMinor = (pounds: string) => Math.max(0, Math.round((parseFloat(pounds) || 0) * 100));

export function TrialFeeEditor() {
  const loadFn = useServerFn(getTrialConfig);
  const saveFn = useServerFn(updateTrialConfig);
  const [cfg, setCfg] = useState<TrialConfig>({ ...DEFAULT_TRIAL_CONFIG });
  const [fee7, setFee7] = useState("");
  const [fee14, setFee14] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const c = (await loadFn({ data: {} })) as TrialConfig;
    setCfg(c);
    setFee7(toPounds(c.trial7FeeMinor));
    setFee14(toPounds(c.trial14FeeMinor));
  }, [loadFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async () => {
    setSaving(true);
    try {
      const updated = (await saveFn({
        data: {
          trial7FeeMinor: toMinor(fee7),
          trial14FeeMinor: toMinor(fee14),
          defaultTrialDays: cfg.defaultTrialDays,
          paidTrialEnabled: cfg.paidTrialEnabled,
        },
      })) as TrialConfig;
      setCfg(updated);
      setFee7(toPounds(updated.trial7FeeMinor));
      setFee14(toPounds(updated.trial14FeeMinor));
      toast.success("Trial fees saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Trial fee</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Charged at signup and credited to the first invoice. Ex-VAT. Editable live - no redeploy.
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <label className="text-sm space-y-1.5">
          <span className="text-muted-foreground text-xs">7-day trial fee (GBP)</span>
          <input type="number" step="0.01" min="0" value={fee7} onChange={(e) => setFee7(e.target.value)} className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm" />
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-muted-foreground text-xs">14-day trial fee (GBP)</span>
          <input type="number" step="0.01" min="0" value={fee14} onChange={(e) => setFee14(e.target.value)} className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm" />
        </label>
        <label className="text-sm space-y-1.5">
          <span className="text-muted-foreground text-xs">Default trial length</span>
          <select value={cfg.defaultTrialDays} onChange={(e) => setCfg((c) => ({ ...c, defaultTrialDays: Number(e.target.value) }))} className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm">
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.paidTrialEnabled} onChange={(ev) => setCfg((c) => ({ ...c, paidTrialEnabled: ev.target.checked }))} className="size-4 rounded border-border" />
        <span>Require payment to start the trial (paid-trial flow). Off = free trial as before.</span>
      </label>
      <button onClick={onSave} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
        {saving ? "Saving..." : "Save trial fees"}
      </button>
    </div>
  );
}
