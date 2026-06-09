import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Company } from "@/lib/types";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";

const sb = supabase as unknown as { from: (t: string) => any };

// per-company usage shape we need (CompanyUsage is a structural superset)
type Usage = { drivers: number; warehouses: number; members: number; vrids30d: number };
const ZERO: Usage = { drivers: 0, warehouses: 0, members: 0, vrids30d: 0 };

const PALETTE = ["#6366f1", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#64748b"];
const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 } as const;

// ---------- Donut (per-company breakdown of one metric) ----------
function Donut({ title, total, slices }: { title: string; total: number; slices: { name: string; value: number }[] }) {
  const data = slices.length ? slices : [{ name: "No data", value: 1 }];
  const empty = slices.length === 0;
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{title}</div>
      <div className="relative h-32">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={56} paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={empty ? "var(--surface-2)" : PALETTE[i % PALETTE.length]} />)}
            </Pie>
            {!empty && <Tooltip contentStyle={tooltipStyle} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <span className="text-xl font-semibold tabular-nums">{total.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// ---------- time bucketing ----------
type RangeKey = "1w" | "1m" | "3m" | "6m" | "1y" | "2y";
type Gran = "day" | "week" | "month";
const RANGES: { k: RangeKey; label: string; days: number; gran: Gran }[] = [
  { k: "1w", label: "1W", days: 7, gran: "day" },
  { k: "1m", label: "1M", days: 30, gran: "day" },
  { k: "3m", label: "3M", days: 90, gran: "week" },
  { k: "6m", label: "6M", days: 180, gran: "week" },
  { k: "1y", label: "1Y", days: 365, gran: "month" },
  { k: "2y", label: "2Y", days: 730, gran: "month" },
];
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const startOfWeek = (d: Date) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
function bucketKey(d: Date, g: Gran): string {
  if (g === "day") return startOfDay(d).toISOString().slice(0, 10);
  if (g === "week") return startOfWeek(d).toISOString().slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function buildBuckets(days: number, g: Gran): { key: string; label: string }[] {
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const out: { key: string; label: string }[] = [];
  if (g === "month") {
    for (let t = startOfMonth(since); t <= now; t.setMonth(t.getMonth() + 1)) {
      out.push({ key: bucketKey(t, "month"), label: t.toLocaleDateString([], { month: "short", year: "2-digit" }) });
    }
  } else {
    const step = g === "day" ? 1 : 7;
    for (let t = g === "day" ? startOfDay(since) : startOfWeek(since); t <= now; t.setDate(t.getDate() + step)) {
      out.push({ key: bucketKey(t, g), label: t.toLocaleDateString([], { day: "2-digit", month: "short" }) });
    }
  }
  return out;
}

type Row = { label: string; activeDrivers: number; vrids: number; driversAdded: number; warehousesAdded: number; tickets: number };

export function AdminAnalytics({ companies, usage }: { companies: Company[]; usage: Record<string, Usage> }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // donuts: split each metric by company (top 6 + remainder)
  const slicesFor = (pick: (u: Usage) => number) => {
    const arr = companies
      .map((c) => ({ name: c.name, value: pick(usage[c.id] ?? ZERO) }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = arr.reduce((s, r) => s + r.value, 0);
    const top = arr.slice(0, 6);
    const rest = arr.slice(6);
    if (rest.length) top.push({ name: `+${rest.length} more`, value: rest.reduce((s, r) => s + r.value, 0) });
    return { slices: top, total };
  };
  const dDrivers = slicesFor((u) => u.drivers);
  const dVrids = slicesFor((u) => u.vrids30d);
  const dWh = slicesFor((u) => u.warehouses);
  const dMembers = slicesFor((u) => u.members);

  // performance chart
  const [companyId, setCompanyId] = useState<string>(companies[0]?.id ?? "");
  const [range, setRange] = useState<RangeKey>("3m");
  const [series, setSeries] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!companyId && companies[0]) setCompanyId(companies[0].id); }, [companies, companyId]);

  useEffect(() => {
    if (!companyId) { setSeries([]); return; }
    let cancelled = false;
    setLoading(true);
    const cfg = RANGES.find((r) => r.k === range)!;
    const since = new Date(Date.now() - cfg.days * 86_400_000).toISOString();
    void (async () => {
      const [jobs, drv, wh, tix] = await Promise.all([
        sb.from("jobs").select("created_at,assigned_driver_id,planned_driver_id").eq("tenant_id", companyId).is("deleted_at", null).gte("created_at", since),
        sb.from("drivers").select("created_at").eq("tenant_id", companyId).gte("created_at", since),
        sb.from("warehouses").select("created_at").eq("tenant_id", companyId).gte("created_at", since),
        sb.from("support_tickets").select("created_at").eq("tenant_id", companyId).gte("created_at", since),
      ]);
      if (cancelled) return;
      const buckets = buildBuckets(cfg.days, cfg.gran);
      const idx: Record<string, Row> = {};
      const order: string[] = [];
      for (const b of buckets) { idx[b.key] = { label: b.label, activeDrivers: 0, vrids: 0, driversAdded: 0, warehousesAdded: 0, tickets: 0 }; order.push(b.key); }
      const active: Record<string, Set<string>> = {};
      for (const j of (jobs.data ?? []) as Array<{ created_at: string; assigned_driver_id: string | null; planned_driver_id: string | null }>) {
        const k = bucketKey(new Date(j.created_at), cfg.gran); const r = idx[k]; if (!r) continue;
        r.vrids++;
        const did = j.assigned_driver_id ?? j.planned_driver_id; if (did) (active[k] ||= new Set()).add(did);
      }
      for (const k in active) if (idx[k]) idx[k].activeDrivers = active[k].size;
      for (const x of (drv.data ?? []) as Array<{ created_at: string }>) { const k = bucketKey(new Date(x.created_at), cfg.gran); if (idx[k]) idx[k].driversAdded++; }
      for (const x of (wh.data ?? []) as Array<{ created_at: string }>) { const k = bucketKey(new Date(x.created_at), cfg.gran); if (idx[k]) idx[k].warehousesAdded++; }
      for (const x of (tix.data ?? []) as Array<{ created_at: string }>) { const k = bucketKey(new Date(x.created_at), cfg.gran); if (idx[k]) idx[k].tickets++; }
      setSeries(order.map((k) => idx[k]));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId, range]);

  const totals = useMemo(() => series.reduce((a, r) => ({
    activeDrivers: Math.max(a.activeDrivers, r.activeDrivers), vrids: a.vrids + r.vrids,
    driversAdded: a.driversAdded + r.driversAdded, warehousesAdded: a.warehousesAdded + r.warehousesAdded, tickets: a.tickets + r.tickets,
  }), { activeDrivers: 0, vrids: 0, driversAdded: 0, warehousesAdded: 0, tickets: 0 }), [series]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Donut title="Drivers" total={dDrivers.total} slices={dDrivers.slices} />
        <Donut title="VRIDs · 30d" total={dVrids.total} slices={dVrids.slices} />
        <Donut title="Warehouses" total={dWh.total} slices={dWh.slices} />
        <Donut title="Members" total={dMembers.total} slices={dMembers.slices} />
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-semibold">Company performance</div>
            <div className="text-[11px] text-muted-foreground">Usage over time — to gauge adoption &amp; pricing tier</div>
          </div>
          <div className="flex items-center gap-2">
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="h-8 px-2 rounded-md border border-border bg-background text-xs max-w-[200px]">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex rounded-md border border-border overflow-hidden">
              {RANGES.map((r) => (
                <button key={r.k} onClick={() => setRange(r.k)}
                  className={"px-2.5 py-1.5 text-xs font-medium " + (range === r.k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-2")}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="h-72">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={28} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="activeDrivers" name="Active drivers" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="vrids" name="VRIDs added" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="driversAdded" name="Drivers added" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="warehousesAdded" name="Warehouses added" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="tickets" name="Tickets raised" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="h-full grid place-items-center text-xs text-muted-foreground">Loading chart…</div>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>Peak active drivers: <b className="text-foreground">{totals.activeDrivers}</b></span>
          <span>VRIDs: <b className="text-foreground">{totals.vrids}</b></span>
          <span>Drivers added: <b className="text-foreground">{totals.driversAdded}</b></span>
          <span>Warehouses added: <b className="text-foreground">{totals.warehousesAdded}</b></span>
          <span>Tickets: <b className="text-foreground">{totals.tickets}</b></span>
          {loading && <span className="italic">refreshing…</span>}
        </div>
      </div>
    </div>
  );
}
