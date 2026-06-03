import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { useDriverStore } from "@/lib/driver-store";

export const Route = createFileRoute("/d/report")({
  head: () => ({ meta: [{ title: "Report — Driver" }] }),
  component: ReportPage,
});

const CATEGORIES = [
  "Vehicle issue", "Traffic delay", "Running late", "Road closure",
  "Cargo / load issue", "Customer issue", "Accident", "Other",
] as const;

const sb = supabase as unknown as { from: (t: string) => any };

function ukDay(offset: number): string {
  const d = new Date(Date.now() - offset * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function dayLabel(day: string, i: number): string {
  if (i === 0) return "Today";
  if (i === 1) return "Yest";
  return new Date(day + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "2-digit" });
}
function fmtHrs(min: number | null | undefined): string {
  const m = Math.max(0, Math.round(min ?? 0));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

type TachoRow = { day: string; drive_minutes: number; tachograph_drive_minutes: number | null; tachograph_status: string | null };

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

  // ── Tachograph hours ──────────────────────────────────────────────────────
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => ukDay(i)), []);
  const [byDay, setByDay] = useState<Record<string, TachoRow>>({});
  const [tDay, setTDay] = useState(days[0]);
  const [tH, setTH] = useState("");
  const [tM, setTM] = useState("");
  const [tBusy, setTBusy] = useState(false);

  const loadTacho = useCallback(async () => {
    if (!driver) return;
    const { data } = await sb
      .from("driver_day_hours")
      .select("day,drive_minutes,tachograph_drive_minutes,tachograph_status")
      .eq("driver_id", driver.id)
      .gte("day", days[days.length - 1]);
    const m: Record<string, TachoRow> = {};
    for (const r of (data ?? []) as TachoRow[]) m[r.day] = r;
    setByDay(m);
  }, [driver, days]);
  useEffect(() => { void loadTacho(); }, [loadTacho]);

  const cur = byDay[tDay];
  const estMin = cur?.drive_minutes ?? 0;

  const saveTacho = async () => {
    if (!driver) return;
    const T = (parseInt(tH || "0", 10) || 0) * 60 + (parseInt(tM || "0", 10) || 0);
    if (T <= 0) { toast.error("Enter your driving time"); return; }
    setTBusy(true);
    try {
      const within = estMin > 0 && Math.abs(T - estMin) <= Math.max(90, 0.4 * estMin);
      const status = within ? "approved" : "pending";
      await sb.from("driver_day_hours").upsert({
        driver_id: driver.id, day: tDay,
        tachograph_drive_minutes: T, tachograph_status: status,
        tachograph_entered_at: new Date().toISOString(), tachograph_entered_by: driver.id,
      }, { onConflict: "driver_id,day" });
      toast.success(within ? "Recorded ✓" : "Saved — awaiting planner approval");
      setTH(""); setTM("");
      await loadTacho();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save tachograph");
    } finally { setTBusy(false); }
  };

  return (
    <div className="pt-6 px-4 pb-10">
      <h1 className="text-2xl font-bold mb-4 text-foreground">Report</h1>

      {/* ── Tachograph ── */}
      <div className="bg-card border border-border rounded-2xl p-4 mb-6">
        <h2 className="text-base font-bold text-foreground">Tachograph hours</h2>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">
          Log your actual driving time. Big differences from our estimate go to the planner to approve.
        </p>
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3" data-no-swipe>
          {days.map((d, i) => {
            const r = byDay[d];
            const active = d === tDay;
            return (
              <button key={d} type="button" onClick={() => setTDay(d)}
                className={`shrink-0 px-3 py-2 rounded-xl border text-xs font-semibold transition ${
                  active ? "bg-primary/15 border-primary text-primary" : "bg-background border-border text-muted-foreground"
                }`}>
                <div>{dayLabel(d, i)}</div>
                {r?.tachograph_status && (
                  <div className="text-[9px] mt-0.5">{r.tachograph_status === "approved" ? "✓" : "⏳"}</div>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mb-2">
          Our estimate: <span className="font-semibold text-foreground">{fmtHrs(estMin)}</span>
          {cur?.tachograph_status && (
            <> · you logged <span className="font-semibold text-foreground">{fmtHrs(cur.tachograph_drive_minutes)}</span> ({cur.tachograph_status})</>
          )}
        </p>
        <div className="flex items-center gap-2 mb-3">
          <input type="number" min={0} max={15} value={tH} onChange={(e) => setTH(e.target.value)} placeholder="hh"
            className="w-16 h-11 text-center bg-background border border-border rounded-lg text-base text-foreground focus:outline-none focus:border-primary" />
          <span className="text-lg font-bold text-muted-foreground">:</span>
          <input type="number" min={0} max={59} value={tM} onChange={(e) => setTM(e.target.value)} placeholder="mm"
            className="w-16 h-11 text-center bg-background border border-border rounded-lg text-base text-foreground focus:outline-none focus:border-primary" />
          <span className="text-xs text-muted-foreground">driving time</span>
        </div>
        <button onClick={saveTacho} disabled={tBusy}
          className="w-full bg-primary text-primary-foreground font-bold py-3 rounded-xl disabled:opacity-40 active:scale-[0.99] transition">
          {tBusy ? "Saving…" : "Save tachograph"}
        </button>
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
