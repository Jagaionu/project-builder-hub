import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { useDriverStore } from "@/lib/driver-store";
import { weekStartOf, addWeeks, ukToday } from "@/lib/week";

export const Route = createFileRoute("/d/report")({
  head: () => ({ meta: [{ title: "Report — Driver" }] }),
  component: ReportPage,
});

const CATEGORIES = [
  "Vehicle issue", "Traffic delay", "Running late", "Road closure",
  "Cargo / load issue", "Customer issue", "Accident", "Other",
] as const;

const sb = supabase as unknown as { from: (t: string) => any };

function fmtHrs(min: number | null | undefined): string {
  const m = Math.max(0, Math.round(min ?? 0));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
function weekLabel(wkStart: string): string {
  const a = new Date(wkStart + "T12:00:00Z");
  const b = new Date(wkStart + "T12:00:00Z");
  b.setUTCDate(b.getUTCDate() + 6);
  const f = (d: Date) => d.toLocaleDateString([], { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${f(a)} – ${f(b)}`;
}

type WeekInfo = { estimate: number; status: string | null; value: number | null };

function ReportPage() {
  const driver = useDriverStore((s) => s.driver);
  const [cat, setCat] = useState<string>(CATEGORIES[0]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!driver) return;
    setLoading(true);
    try {
      const tenant_id = await getTenantId();
      await supabase.from("driver_events").insert({
        driver_id: driver.id, type: "DELAY_REPORT", payload: { category: cat, notes }, tenant_id,
      } as never);
      setSent(true); setNotes("");
      setTimeout(() => setSent(false), 3000);
    } finally { setLoading(false); }
  };

  // ── Weekly tachograph reconciliation ──────────────────────────────────────
  const thisWk = useMemo(() => weekStartOf(ukToday()), []);
  const buckets = useMemo(
    () => [
      { wk: addWeeks(thisWk, -1), label: "Last week" },
      { wk: addWeeks(thisWk, -2), label: "2 weeks ago" },
    ],
    [thisWk],
  );
  const [info, setInfo] = useState<Record<string, WeekInfo>>({});
  const [inputs, setInputs] = useState<Record<string, { h: string; m: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const loadTacho = useCallback(async () => {
    if (!driver) return;
    const since = addWeeks(thisWk, -2);
    const [{ data: days }, { data: wk }] = await Promise.all([
      sb.from("driver_day_hours").select("day,drive_minutes").eq("driver_id", driver.id).gte("day", since),
      sb.from("driver_week_hours").select("week_start,tacho_drive_minutes,status").eq("driver_id", driver.id).gte("week_start", since),
    ]);
    const est: Record<string, number> = {};
    for (const r of (days ?? []) as Array<{ day: string; drive_minutes: number | null }>) {
      const w = weekStartOf(r.day);
      est[w] = (est[w] ?? 0) + (r.drive_minutes ?? 0);
    }
    const weekRows = (wk ?? []) as Array<{ week_start: string; tacho_drive_minutes: number; status: string }>;
    const m: Record<string, WeekInfo> = {};
    for (const b of buckets) {
      const e = weekRows.find((x) => x.week_start === b.wk);
      m[b.wk] = { estimate: est[b.wk] ?? 0, status: e?.status ?? null, value: e?.tacho_drive_minutes ?? null };
    }
    setInfo(m);
  }, [driver, thisWk, buckets]);
  useEffect(() => { void loadTacho(); }, [loadTacho]);

  const saveWeek = async (wk: string) => {
    if (!driver) return;
    const inp = inputs[wk] ?? { h: "", m: "" };
    const T = (parseInt(inp.h || "0", 10) || 0) * 60 + (parseInt(inp.m || "0", 10) || 0);
    if (T <= 0) { toast.error("Enter the week's driving time"); return; }
    setBusy(wk);
    try {
      const E = info[wk]?.estimate ?? 0;
      const within = E > 0 && Math.abs(T - E) <= Math.max(120, 0.4 * E);
      const status = within ? "approved" : "pending";
      await sb.from("driver_week_hours").upsert({
        driver_id: driver.id, week_start: wk, tacho_drive_minutes: T, status,
        entered_at: new Date().toISOString(), entered_by: driver.id,
      }, { onConflict: "driver_id,week_start" });
      toast.success(within ? "Recorded ✓" : "Saved — awaiting planner approval");
      setInputs((s) => ({ ...s, [wk]: { h: "", m: "" } }));
      await loadTacho();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally { setBusy(null); }
  };

  const setInp = (wk: string, k: "h" | "m", v: string) =>
    setInputs((s) => ({ ...s, [wk]: { ...(s[wk] ?? { h: "", m: "" }), [k]: v } }));

  return (
    <div className="pt-6 px-4 pb-10">
      <h1 className="text-2xl font-bold mb-4 text-foreground">Report</h1>

      {/* ── Weekly tachograph ── */}
      <div className="bg-card border border-border rounded-2xl p-4 mb-6">
        <h2 className="text-base font-bold text-foreground">Tachograph hours (weekly)</h2>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">
          Log your total driving for each completed week. Big differences from our estimate go to the planner to approve.
        </p>
        <div className="space-y-3">
          {buckets.map((b) => {
            const i = info[b.wk];
            const inp = inputs[b.wk] ?? { h: "", m: "" };
            return (
              <div key={b.wk} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-sm text-foreground">{b.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{weekLabel(b.wk)}</div>
                  </div>
                  {i?.status && (
                    <span className="text-[10px] font-mono" style={{ color: i.status === "approved" ? "var(--success)" : "var(--warning)" }}>
                      {i.status === "approved" ? "✓ approved" : "⏳ pending"}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Our estimate: <span className="font-semibold text-foreground">{fmtHrs(i?.estimate)}</span>
                  {i?.value != null && <> · you logged <span className="font-semibold text-foreground">{fmtHrs(i.value)}</span></>}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <input type="number" min={0} max={99} value={inp.h} onChange={(e) => setInp(b.wk, "h", e.target.value)} placeholder="hh"
                    className="w-14 h-10 text-center bg-background border border-border rounded-lg text-base text-foreground focus:outline-none focus:border-primary" />
                  <span className="font-bold text-muted-foreground">:</span>
                  <input type="number" min={0} max={59} value={inp.m} onChange={(e) => setInp(b.wk, "m", e.target.value)} placeholder="mm"
                    className="w-14 h-10 text-center bg-background border border-border rounded-lg text-base text-foreground focus:outline-none focus:border-primary" />
                  <button onClick={() => saveWeek(b.wk)} disabled={busy === b.wk}
                    className="ml-auto px-4 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-40 active:scale-95 transition">
                    {busy === b.wk ? "…" : "Save"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Incident report ── */}
      <h2 className="text-base font-bold text-foreground mb-1">Report an issue</h2>
      <p className="text-sm text-muted-foreground mb-4">File an incident or delay. Dispatch will be notified.</p>

      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Category</label>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`text-sm font-semibold py-3 rounded-xl border transition ${
              cat === c ? "bg-primary/15 border-primary text-primary" : "bg-card border-border text-muted-foreground"
            }`}>{c}</button>
        ))}
      </div>

      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Notes</label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
        placeholder="Describe what happened…"
        className="w-full bg-card border border-border rounded-xl p-3 text-sm text-foreground focus:outline-none focus:border-primary mb-4" />

      <button onClick={submit} disabled={loading}
        className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-xl disabled:opacity-40 active:scale-[0.99] transition">
        {loading ? "Sending…" : sent ? "✓ Sent" : "Submit report"}
      </button>
    </div>
  );
}
