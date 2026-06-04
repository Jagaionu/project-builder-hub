import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "./_app.index";

export const Route = createFileRoute("/_app/events")({
  component: ActivityLog,
  head: () => ({ meta: [{ title: "Events — Planning System" }] }),
});

type ActivityRow = {
  id: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_ref: string | null;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  "lane.create": "Lane created",
  "lane.upload": "Lanes uploaded",
  "plan.run": "Planner run",
  "job.cancel": "Route cancelled",
  "job.assign": "Driver assigned",
  "job.delete": "Job deleted",
  "import.delete": "Import deleted",
  "driver.create": "Driver added",
  "driver.edit": "Driver edited",
};

const labelFor = (a: string) => ACTION_LABEL[a] ?? a;

function ActivityLog() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");

  useEffect(() => {
    const sb = supabase as unknown as { from: (t: string) => any };
    sb.from("activity_log")
      .select("id, actor_name, actor_email, action, entity_type, entity_ref, created_at")
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }: { data: ActivityRow[] | null }) => {
        if (data) setRows(data);
      });
  }, []);

  const actions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.action);
    return ["ALL", ...Array.from(s).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter !== "ALL" && r.action !== actionFilter) return false;
      if (!needle) return true;
      return (
        (r.actor_name ?? "").toLowerCase().includes(needle) ||
        (r.actor_email ?? "").toLowerCase().includes(needle) ||
        (r.entity_ref ?? "").toLowerCase().includes(needle) ||
        labelFor(r.action).toLowerCase().includes(needle)
      );
    });
  }, [rows, actionFilter, q]);

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Events" subtitle={`${filtered.length} of ${rows.length} · last 14 days`} />

      <div className="px-5 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: "1px solid var(--sidebar-divider)" }}>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {actions.map((a) => (
            <option key={a} value={a}>{a === "ALL" ? "All events" : labelFor(a)}</option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search login / reference…"
          className="h-8 flex-1 min-w-[180px] rounded-md border border-border bg-surface px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex-1 overflow-auto p-5">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">No events recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border">
                <th className="py-2 pr-4">Login</th>
                <th className="py-2 pr-4">Event Date</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2">Ref</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--sidebar-divider)" }}>
                  <td className="py-2 pr-4">{r.actor_name ?? r.actor_email ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                  </td>
                  <td className="py-2 pr-4">{labelFor(r.action)}</td>
                  <td className="py-2 font-mono text-xs text-muted-foreground">{r.entity_ref ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
