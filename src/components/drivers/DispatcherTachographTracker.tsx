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
  id: string;
  driver_id: string;
  period_start: string;
  period_end: string;
  status: string;
  submitted_at: string | null;
  discrepancy: boolean;
};
type Filter = "all" | "pending" | "submitted";

function periodLabel(start: string, end: string): string {
  const f = (d: string) =>
    new Date(d + "T12:00:00Z").toLocaleDateString([], {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    });
  return f(start) + "–" + f(end);
}

export function DispatcherTachographTracker({
  drivers,
  onClose,
}: {
  drivers: Driver[];
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) m.set(d.id, d.name);
    return m;
  }, [drivers]);

  const load = useCallback(async () => {
    let q = sb
      .from("tachograph_requests")
      .select("id,driver_id,period_start,period_end,status,submitted_at,discrepancy")
      .order("period_start", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    setRows((data ?? []) as Row[]);
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const ch = supabase
      .channel("rt-tacho-disp-" + Math.random().toString(36).slice(2))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tachograph_requests" },
        () => void load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const resend = async (id: string) => {
    const { error } = await sb.rpc("resend_tachograph_request", { p_request_id: id });
    if (error) {
      toast.error("Could not resend");
      return;
    }
    toast.success("Request re-sent to the driver");
    await load();
  };

  // One row per driver; each week shown as a chip (latest first, up to 4).
  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const a = m.get(r.driver_id) ?? [];
      a.push(r);
      m.set(r.driver_id, a);
    }
    const out: { driverId: string; weeks: Row[] }[] = [];
    for (const [driverId, list] of m) {
      const weeks = [...list]
        .sort((a, b) => b.period_start.localeCompare(a.period_start))
        .slice(0, 4);
      out.push({ driverId, weeks });
    }
    out.sort((a, b) =>
      (nameById.get(a.driverId) ?? "").localeCompare(nameById.get(b.driverId) ?? ""),
    );
    return out;
  }, [rows, nameById]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Tachograph Hours Tracking</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
          {(["all", "pending", "submitted"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "px-3 py-1.5 rounded-md text-xs font-medium border capitalize " +
                (filter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground")
              }
            >
              {f === "submitted" ? "Received" : f}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">{grouped.length} driver(s)</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left w-44">Driver</th>
                <th className="px-4 py-2 text-left">Weeks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grouped.map((g) => (
                <tr key={g.driverId} className="hover:bg-surface-2/40 align-top">
                  <td className="px-4 py-3 font-medium">{nameById.get(g.driverId) ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {g.weeks.map((w) => (
                        <span
                          key={w.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                        >
                          <span className="font-mono">
                            {periodLabel(w.period_start, w.period_end)}
                          </span>
                          {w.status === "submitted" ? (
                            <span className="font-semibold text-success">✓ received</span>
                          ) : w.status === "archived" ? (
                            <span className="text-muted-foreground">archived</span>
                          ) : (
                            <span className="font-semibold text-destructive">pending</span>
                          )}
                          {w.discrepancy && (
                            <span
                              className="text-warning"
                              title="Submitted hours differ a lot from the GPS estimate"
                            >
                              ⚠
                            </span>
                          )}
                          {w.status === "submitted" && (
                            <button
                              onClick={() => resend(w.id)}
                              className="ml-1 text-[10px] underline text-muted-foreground hover:text-foreground"
                            >
                              resend
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {grouped.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    No requests
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
