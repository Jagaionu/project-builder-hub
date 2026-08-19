import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRevenueMetrics } from "@/lib/billing/revenue.functions";

interface Metrics {
  activeSubscribers: number;
  mrrMinor: number;
  revenue30dMinor: number;
  revenue12mMinor: number;
  revenueAllMinor: number;
}

const gbp = (m: number) =>
  "£" + (m / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      {sub && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</div>}
    </div>
  );
}

export function RevenueDashboard() {
  const fetchMetrics = useServerFn(getRevenueMetrics);
  const [m, setM] = useState<Metrics | null>(null);
  const [threshold, setThreshold] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const t = localStorage.getItem("revenue.threshold.gbp");
      if (t) setThreshold(t);
    }
    void fetchMetrics({ data: {} })
      .then((r) => setM(r as Metrics))
      .catch(() => {});
  }, [fetchMetrics]);

  const saveThreshold = (v: string) => {
    setThreshold(v);
    if (typeof window !== "undefined") localStorage.setItem("revenue.threshold.gbp", v);
  };

  const thresholdMinor = (parseFloat(threshold) || 0) * 100;
  const crossed = !!m && thresholdMinor > 0 && m.revenue12mMinor >= thresholdMinor;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card label="Estimated MRR" value={gbp(m?.mrrMinor ?? 0)} sub="active subscriptions, net/month" />
        <Card label="Active subscribers" value={String(m?.activeSubscribers ?? 0)} />
        <Card label="Net revenue - last 30 days" value={gbp(m?.revenue30dMinor ?? 0)} />
        <Card label="Net revenue - last 12 months" value={gbp(m?.revenue12mMinor ?? 0)} />
        <Card label="Net revenue - all time" value={gbp(m?.revenueAllMinor ?? 0)} />
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Business-structure alert</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set a trailing-12-month net revenue level to be reminded when you cross it. This is a
            prompt to review your setup with an accountant - not tax advice.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground text-xs">Alert threshold (GBP, 12-month net)</span>
          <input
            type="number"
            min="0"
            step="1000"
            value={threshold}
            onChange={(e) => saveThreshold(e.target.value)}
            placeholder="50000"
            className="w-32 h-9 px-2 rounded-md border border-border bg-background text-sm"
          />
        </label>
        {crossed && (
          <div className="rounded-lg border border-orange-400/50 bg-orange-500/10 px-3 py-2 text-sm text-orange-700 dark:text-orange-300">
            Your trailing-12-month net revenue ({gbp(m!.revenue12mMinor)}) has crossed your{" "}
            {gbp(thresholdMinor)} threshold. Good moment to review your business structure with an
            accountant.
          </div>
        )}
      </div>
    </div>
  );
}
