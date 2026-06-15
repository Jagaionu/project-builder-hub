import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Company } from "@/lib/types";
import { Search, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";

const sb = supabase as unknown as { from: (t: string) => any };

type Log = {
  id: string;
  tenant_id: string;
  question: string;
  answer: string | null;
  answered: boolean;
  retrieved_chunk_ids: string[] | null;
  created_at: string;
};

function when(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Super-admin view of what the AI is asked — surfaces the questions it could
// NOT answer ("I don't know" / no documents retrieved) so they become the
// knowledge-base backlog. Reads ai_query_logs across all tenants (RLS allows
// super admins). Most-asked gaps float to the top.
export function AdminAIInsights({ companies }: { companies: Company[] }) {
  const [rows, setRows] = useState<Log[]>([]);
  const [view, setView] = useState<"gaps" | "all">("gaps");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies) m.set(c.id, c.name);
    return m;
  }, [companies]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb
      .from("ai_query_logs")
      .select("id,tenant_id,question,answer,answered,retrieved_chunk_ids,created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    setRows((data ?? []) as Log[]);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const gaps = useMemo(() => rows.filter((r) => !r.answered), [rows]);
  const q = search.trim().toLowerCase();

  // Group unanswered questions by normalised text — repeats = higher priority.
  const groupedGaps = useMemo(() => {
    const m = new Map<
      string,
      { question: string; count: number; last: string; companies: Set<string> }
    >();
    for (const r of gaps) {
      const key = r.question.trim().toLowerCase();
      const g = m.get(key) ?? {
        question: r.question.trim(),
        count: 0,
        last: r.created_at,
        companies: new Set<string>(),
      };
      g.count += 1;
      if (r.created_at > g.last) g.last = r.created_at;
      g.companies.add(nameById.get(r.tenant_id) ?? "—");
      m.set(key, g);
    }
    let arr = Array.from(m.values()).sort(
      (a, b) => b.count - a.count || (a.last < b.last ? 1 : -1),
    );
    if (q) arr = arr.filter((g) => g.question.toLowerCase().includes(q));
    return arr;
  }, [gaps, nameById, q]);

  const allShown = useMemo(
    () => (q ? rows.filter((r) => r.question.toLowerCase().includes(q)) : rows),
    [rows, q],
  );

  const answeredPct = rows.length ? Math.round(((rows.length - gaps.length) / rows.length) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Questions · last 1000" value={rows.length} />
        <Stat label="Unanswered (gaps)" value={gaps.length} tone="warn" />
        <Stat label="Distinct gaps" value={groupedGaps.length} />
        <Stat label="Answer rate" value={`${answeredPct}%`} tone={answeredPct >= 70 ? "ok" : "warn"} />
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground flex items-center gap-2">
        <Sparkles className="size-3.5 text-primary shrink-0" />
        These are the questions drivers and dispatchers asked the assistant. The gaps below are
        your content backlog — add docs under <code className="text-foreground">docs/kb</code> and
        re-ingest to close them.
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["gaps", "all"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={
              "px-3 py-1.5 rounded-md text-xs font-medium border " +
              (view === v
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground")
            }
          >
            {v === "gaps" ? "Gaps (unanswered)" : "All questions"}
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions…"
            className="h-8 w-64 pl-8 pr-2 rounded-md border border-border bg-surface text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-xs text-muted-foreground">Loading…</div>
      ) : view === "gaps" ? (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Question the AI couldn't answer</th>
                <th className="px-3 py-2 text-left">Asked by</th>
                <th className="px-3 py-2 text-left">Last asked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groupedGaps.map((g, i) => (
                <tr key={i} className="hover:bg-surface-2/40">
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1 rounded bg-warning/15 text-warning text-[11px] font-bold tabular-nums">
                      {g.count}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{g.question}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {Array.from(g.companies).slice(0, 3).join(", ")}
                    {g.companies.size > 3 ? ` +${g.companies.size - 3}` : ""}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {when(g.last)}
                  </td>
                </tr>
              ))}
              {groupedGaps.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-xs text-muted-foreground">
                    No unanswered questions{q ? " match your search" : " — the assistant answered everything"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Question</th>
                <th className="px-3 py-2 text-left">Company</th>
                <th className="px-3 py-2 text-left">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allShown.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/40 align-top">
                  <td className="px-3 py-2.5">
                    {r.answered ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <AlertCircle className="size-4 text-warning" />
                    )}
                  </td>
                  <td className="px-3 py-2.5">{r.question}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {nameById.get(r.tenant_id) ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {when(r.created_at)}
                  </td>
                </tr>
              ))}
              {allShown.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-xs text-muted-foreground">
                    No questions logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={"text-xl font-semibold mt-0.5 tabular-nums " + color}>{value}</div>
    </div>
  );
}
