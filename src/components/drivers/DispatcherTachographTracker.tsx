import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X } from "lucide-react";
import type { Driver } from "@/lib/types";

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

type Row = {
  id: string; driver_id: string; period_start: string; period_end: string;
  status: string; submitted_at: string | null; drive_minutes: number | null;
  estimate_minutes: number | null; discrepancy: boolean;
};
type Filter = "all" | "pending" | "submitted";

function periodLabel(start: string, end: string): string {
  const f = (d: string) =>
    new Date(d + "T12:00:00Z").toLocaleDateString([], { day: "2-digit", month: "short", timeZone: "UTC" });
  return f(start) + " – " + f(end);
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short" });
}
const BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  pending:   { bg: "var(--destructive)", fg: "#fff", label: "Pending" },
  submitted: { bg: "var(--success)",     fg: "#fff", label: "Received" },
  archived:  { bg: "var(--muted-foreground-2)", fg: "#fff", label: "Archived" },
};

export function DispatcherTachographTracker({ drivers, onClose }: { drivers: Driver[]; onClose: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) m.set(d.id, d.name);
    return m;
  }, [drivers]);

  const load = useCallback(async () => {
    let q = sb.from("tachograph_requests")
      .select("id,driver_id,period_start,period_end,status,submitted_at,drive_minutes,estimate_minutes,discrepancy")
      .order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    setRows((data ?? []) as Row[]);
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const ch = supabase
      .channel("rt-tacho-disp-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "tachograph_requests" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const resend = async (id: string) => {
    const { error } = await sb.rpc("resend_tachograph_request", { p_request_id: id });
    if (error) { toast.error("Could not resend"); return; }
    toast.success("Request re-sent to the driver");
    await load();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Tachograph Hours Tracking</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
          {(["all", "pending", "submitted"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={"px-3 py-1.5 rounded-md text-xs font-medium border capitalize " + (filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground")}>
              {f === "submitted" ? "Received" : f}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">{rows.length} request(s)</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground sticky top-0">
              <tr><th className="px-4 py-2 text-left">Driver</th><th className="px-4 py-2 text-left">Period</th>
              <th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2 text-left">Submitted</th>
              <th className="px-4 py-2 text-right"></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const b = BADGE[r.status] ?? BADGE.archived;
                return (
                  <tr key={r.id} className="hover:bg-surface-2/40">
                    <td className="px-4 py-2.5 font-medium">{nameById.get(r.driver_id) ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{periodLabel(r.period_start, r.period_end)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold" style={{ background: b.bg, color: b.fg }}>{b.label}</span>
                      {r.discrepancy && <span className="ml-1.5 text-[10px] text-warning" title="Submitted hours differ a lot from the GPS estimate">⚠ review</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(r.submitted_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {r.status === "submitted" && (
                        <button onClick={() => resend(r.id)} className="px-2 py-1 rounded border border-border text-xs hover:bg-surface-2">Resend request</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">No requests</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
