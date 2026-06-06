import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";
import { toast } from "sonner";

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export type TachoRequest = {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
};

function periodLabel(start: string, end: string): string {
  const f = (d: string) =>
    new Date(d + "T12:00:00Z").toLocaleDateString([], { day: "2-digit", month: "short", timeZone: "UTC" });
  return f(start) + " – " + f(end);
}

// Pending tachograph requests for the logged-in driver (RLS scopes to self).
export function usePendingTachoRequests() {
  const driverId = useDriverStore((s) => s.driver?.id);
  const [pending, setPending] = useState<TachoRequest[]>([]);
  const load = useCallback(async () => {
    if (!driverId) { setPending([]); return; }
    const { data } = await sb
      .from("tachograph_requests")
      .select("id,period_start,period_end,status")
      .eq("driver_id", driverId)
      .eq("status", "pending")
      .order("period_start", { ascending: true });
    setPending((data ?? []) as TachoRequest[]);
  }, [driverId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!driverId) return;
    const ch = supabase
      .channel("rt-tacho-" + Math.random().toString(36).slice(2))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "tachograph_requests", filter: `driver_id=eq.${driverId}` },
        () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [driverId, load]);
  return { pending, reload: load };
}

// Forced modal: shows while the driver has any pending request. Not dismissable
// — the driver must submit each weeks real driving time. Submitting auto-applies
// to the compliance rings server-side and flags a large gap for the office.
export function DriverTachographModal() {
  const { pending, reload } = usePendingTachoRequests();
  const [h, setH] = useState("");
  const [m, setM] = useState("");
  const [brk, setBrk] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const req = pending[0] ?? null;
  if (!req) return null;

  const submit = async () => {
    const drive = (parseInt(h || "0", 10) || 0) * 60 + (parseInt(m || "0", 10) || 0);
    if (drive <= 0) { toast.error("Enter your driving time for the week"); return; }
    setBusy(true);
    try {
      const { error } = await sb.rpc("log_tachograph_hours", {
        p_request_id: req.id,
        p_drive_minutes: drive,
        p_break_mins: brk ? parseInt(brk, 10) : null,
        p_notes: notes || null,
      });
      if (error) throw error;
      toast.success("Hours submitted");
      setH(""); setM(""); setBrk(""); setNotes("");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4" data-no-swipe>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <h2 className="text-lg font-bold text-foreground">Tachograph hours required</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Submit your real driving time for this week. {pending.length > 1 ? `${pending.length} weeks to confirm.` : ""}
        </p>
        <div className="mt-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
          <span className="text-muted-foreground">Week: </span>
          <span className="font-mono font-semibold text-foreground">{periodLabel(req.period_start, req.period_end)}</span>
        </div>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">Driving time</label>
        <div className="mt-2 flex items-center gap-2">
          <input type="number" min={0} max={99} value={h} onChange={(e) => setH(e.target.value)} placeholder="hh"
            className="w-16 h-11 text-center bg-background border border-border rounded-lg text-base text-foreground focus:outline-none focus:border-primary" />
          <span className="font-bold text-muted-foreground">:</span>
          <input type="number" min={0} max={59} value={m} onChange={(e) => setM(e.target.value)} placeholder="mm"
            className="w-16 h-11 text-center bg-background border border-border rounded-lg text-base text-foreground focus:outline-none focus:border-primary" />
          <input type="number" min={0} value={brk} onChange={(e) => setBrk(e.target.value)} placeholder="break (min)"
            className="flex-1 h-11 px-3 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary" />
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
          className="mt-3 w-full bg-background border border-border rounded-lg p-3 text-sm text-foreground focus:outline-none focus:border-primary" />
        <button onClick={submit} disabled={busy}
          className="mt-4 w-full bg-primary text-primary-foreground font-bold py-3.5 rounded-xl disabled:opacity-40 active:scale-[0.99] transition">
          {busy ? "Submitting…" : "Submit hours"}
        </button>
      </div>
    </div>
  );
}
