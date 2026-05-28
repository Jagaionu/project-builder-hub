import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight,
  Play, Square, MapPin, CheckCircle2, AlertTriangle,
  Send, Ban, XCircle, Activity,
  Upload, Trash2, FileText, Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDrivers, useJobs } from "@/lib/hooks";
import { useServerFn } from "@tanstack/react-start";
import { deleteImportBatch } from "@/lib/delete-import-batch.functions";
import { toast } from "sonner";
import { PageHeader } from "./_app.index";
import type { DriverEvent, Job } from "@/lib/types";
import type { ImportBatchSummary } from "@/lib/jobs-import.functions";

export const Route = createFileRoute("/_app/events")({
  component: EventLog,
  head: () => ({ meta: [{ title: "Event Log — Planning System" }] }),
});

const EVENT_CONFIG: Record<string, {
  color: string;
  bg: string;
  Icon: React.ElementType;
}> = {
  START_SHIFT:        { color: "oklch(0.73 0.17 150)", bg: "oklch(0.73 0.17 150 / 0.10)", Icon: Play },
  END_SHIFT:          { color: "oklch(0.52 0.012 245)",bg: "oklch(0.22 0.018 245)",        Icon: Square },
  END_SHIFT_BLOCKED:  { color: "oklch(0.80 0.16 72)",  bg: "oklch(0.80 0.18 72  / 0.10)", Icon: Ban },
  LOCATION_UPDATE:    { color: "oklch(0.45 0.012 245)",bg: "oklch(0.20 0.018 245)",        Icon: MapPin },
  ACCEPT_JOB:         { color: "oklch(0.73 0.17 150)", bg: "oklch(0.73 0.17 150 / 0.10)", Icon: CheckCircle2 },
  JOB_CARD_SENT:      { color: "oklch(0.62 0.22 245)", bg: "oklch(0.62 0.22 245 / 0.10)", Icon: Send },
  DELAY_REPORT:       { color: "oklch(0.80 0.16 72)",  bg: "oklch(0.80 0.18 72  / 0.10)", Icon: AlertTriangle },
  CANT_COMPLETE:      { color: "oklch(0.63 0.22 20)",  bg: "oklch(0.63 0.22 20  / 0.10)", Icon: XCircle },
};

function useImportBatches() {
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("import_batches" as never)
        .select("id,file_name,row_count,created_count,parked_count,duplicate_count,error_count,created_at,expires_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (mounted && data) setBatches(data as unknown as ImportBatchSummary[]);
    };
    load();
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => { if (t) clearTimeout(t); t = setTimeout(() => void load(), 500); };
    const ch = supabase
      .channel(`rt-import-batches-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "import_batches" }, debounced)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);
  return batches;
}

function EventLog() {
  const drivers = useDrivers();
  const jobs    = useJobs();
  const [events, setEvents]           = useState<DriverEvent[]>([]);
  const [openDrivers, setOpenDrivers] = useState<Set<string>>(new Set());
  const [showRaw, setShowRaw]         = useState(false);
  const [tab, setTab]                 = useState<"driver" | "imports">("imports");
  const batches                       = useImportBatches();
  const runDelete                     = useServerFn(deleteImportBatch);

  useEffect(() => {
    supabase.from("driver_events").select("*")
      .order("timestamp", { ascending: false }).limit(500)
      .then(({ data }) => { if (data) setEvents(data as DriverEvent[]); });
    const ch = supabase.channel("rt-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "driver_events" },
        (payload) => setEvents((prev) => [payload.new as DriverEvent, ...prev].slice(0, 500)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function confirmDeleteBatch(batch: ImportBatchSummary) {
    const msg = `Delete import "${batch.file_name}"?\n\nThis will permanently remove all ${batch.created_count} job(s) created from this file. This cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      const res = await runDelete({ data: { batchId: batch.id } });
      toast.success(`Deleted ${(res as { deleted?: number }).deleted ?? batch.created_count} job(s) from "${batch.file_name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const jobsById = useMemo(() => {
    const m: Record<string, Job> = {};
    for (const j of jobs) m[j.id] = j;
    return m;
  }, [jobs]);

  const grouped = useMemo(() => {
    const map = new Map<string, DriverEvent[]>();
    for (const e of events) {
      if (!map.has(e.driver_id)) map.set(e.driver_id, []);
      map.get(e.driver_id)!.push(e);
    }
    return Array.from(map.entries())
      .map(([driverId, evs]) => ({ driverId, events: evs }))
      .sort((a, b) => +new Date(b.events[0].timestamp) - +new Date(a.events[0].timestamp));
  }, [events]);

  const toggle = (id: string) =>
    setOpenDrivers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Event Log"
        subtitle={tab === "imports"
          ? `${batches.length} import${batches.length !== 1 ? "s" : ""}`
          : `${grouped.length} drivers · ${events.length} events`}
        right={tab === "driver" ? (
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            <input
              type="checkbox" checked={showRaw}
              onChange={(e) => setShowRaw(e.target.checked)}
              className="size-3 accent-primary"
            />
            Raw payload
          </label>
        ) : undefined}
      />

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-border px-5">
        {(["imports", "driver"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "imports" ? (
              <span className="flex items-center gap-1.5"><Upload className="size-3.5" /> Import Batches</span>
            ) : (
              <span className="flex items-center gap-1.5"><Activity className="size-3.5" /> Driver Events</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-2">
        {/* ── Import Batches tab ─────────────────────────────────────────── */}
        {tab === "imports" && (batches.length === 0 ? (
          <div
            className="rounded-xl border px-4 py-10 text-center"
            style={{ background: "oklch(0.17 0.018 245)", borderColor: "oklch(0.24 0.018 245)" }}
          >
            <Upload className="size-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No imports yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Each CSV upload will appear here. Batches expire after 14 days.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {batches.map((b) => {
              const expires = new Date(b.expires_at);
              const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86_400_000));
              const uploadedAt = new Date(b.created_at);
              return (
                <div
                  key={b.id}
                  className="rounded-xl border overflow-hidden"
                  style={{ background: "oklch(0.17 0.018 245)", borderColor: "oklch(0.22 0.018 245)" }}
                >
                  <div className="px-4 py-3 flex items-center gap-3">
                    {/* File icon */}
                    <div
                      className="size-9 rounded-lg grid place-items-center shrink-0"
                      style={{ background: "oklch(0.62 0.22 245 / 0.10)", border: "1px solid oklch(0.62 0.22 245 / 0.20)" }}
                    >
                      <FileText className="size-4" style={{ color: "oklch(0.72 0.18 245)" }} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{b.file_name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground/60">
                          {uploadedAt.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}{" "}
                          {uploadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] font-mono">
                        <span style={{ color: "oklch(0.73 0.17 150)" }}>✓ {b.created_count} created</span>
                        {b.parked_count > 0 && (
                          <span style={{ color: "oklch(0.80 0.16 72)" }}>⏸ {b.parked_count} parked</span>
                        )}
                        {b.duplicate_count > 0 && (
                          <span className="text-muted-foreground">⟳ {b.duplicate_count} duplicate</span>
                        )}
                        {b.error_count > 0 && (
                          <span style={{ color: "oklch(0.63 0.22 20)" }}>✕ {b.error_count} errors</span>
                        )}
                        <span
                          className="flex items-center gap-1 text-muted-foreground/60"
                          title={`Expires ${expires.toLocaleString()}`}
                        >
                          <Clock className="size-3" />
                          {daysLeft === 0 ? "expires today" : `${daysLeft}d left`}
                        </span>
                      </div>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={() => confirmDeleteBatch(b)}
                      className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/5 hover:bg-red-500/15 text-red-500 text-xs font-medium transition-colors"
                      title={`Delete all ${b.created_count} jobs from this import`}
                    >
                      <Trash2 className="size-3.5" />
                      Delete all jobs
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* ── Driver Events tab ──────────────────────────────────────────── */}
        {tab === "driver" && (grouped.length === 0 ? (
          <div
            className="rounded-xl border px-4 py-10 text-center"
            style={{ background: "oklch(0.17 0.018 245)", borderColor: "oklch(0.24 0.018 245)" }}
          >
            <Activity className="size-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No events yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Driver actions in the app will populate this stream.
            </p>
          </div>
        ) : (
          grouped.map(({ driverId, events: evs }) => {
            const drv     = drivers.find((d) => d.id === driverId);
            const isOpen  = openDrivers.has(driverId);
            const latest  = evs[0];
            const todayCount = evs.filter(
              (e) => new Date(e.timestamp).toDateString() === new Date().toDateString(),
            ).length;
            const latestCfg = EVENT_CONFIG[latest.type];

            return (
              <div
                key={driverId}
                className="rounded-xl overflow-hidden transition-all"
                style={{
                  background: "oklch(0.17 0.018 245)",
                  border: `1px solid ${isOpen ? "oklch(0.28 0.020 245)" : "oklch(0.22 0.018 245)"}`,
                  boxShadow: isOpen ? "0 4px 16px oklch(0 0 0 / 0.25)" : "none",
                }}
              >
                {/* Driver header row */}
                <button
                  type="button"
                  onClick={() => toggle(driverId)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left transition-colors"
                  style={{ background: isOpen ? "oklch(0.20 0.020 245)" : "transparent" }}
                >
                  {isOpen
                    ? <ChevronDown  className="size-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}

                  {/* Avatar */}
                  <div
                    className="size-7 rounded-lg grid place-items-center text-xs font-bold font-mono shrink-0"
                    style={{
                      background: "oklch(0.62 0.22 245 / 0.12)",
                      color: "oklch(0.75 0.18 245)",
                      border: "1px solid oklch(0.62 0.22 245 / 0.25)",
                    }}
                  >
                    {(drv?.name ?? "?")[0]?.toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {drv?.name ?? driverId.slice(0, 8)}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {todayCount} today · {evs.length} total
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground truncate">
                      {latestCfg && (
                        <latestCfg.Icon
                          className="size-3 shrink-0"
                          style={{ color: latestCfg.color }}
                        />
                      )}
                      <span className="truncate">{summarize(latest, jobsById)}</span>
                      <span className="opacity-50 shrink-0">· {relTime(latest.timestamp)}</span>
                    </div>
                  </div>
                </button>

                {/* Events timeline */}
                {isOpen && (
                  <ul
                    className="divide-y"
                    style={{ borderTop: "1px solid oklch(0.22 0.018 245)", borderColor: "oklch(0.22 0.018 245)" }}
                  >
                    {evs.map((e) => {
                      const cfg = EVENT_CONFIG[e.type];
                      const Icon = cfg?.Icon ?? Activity;
                      return (
                        <li
                          key={e.id}
                          className="px-4 py-2.5 flex items-start gap-3 transition-colors"
                          style={{ borderColor: "oklch(0.20 0.016 245)" }}
                          onMouseEnter={el => (el.currentTarget.style.background = "oklch(0.20 0.018 245)")}
                          onMouseLeave={el => (el.currentTarget.style.background = "transparent")}
                        >
                          {/* Time */}
                          <span className="text-[10px] font-mono text-muted-foreground/60 w-12 shrink-0 pt-0.5 tabular-nums">
                            {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>

                          {/* Icon */}
                          <div
                            className="size-5 rounded-md grid place-items-center shrink-0 mt-0.5"
                            style={{ background: cfg?.bg ?? "oklch(0.20 0.018 245)" }}
                          >
                            <Icon className="size-3" style={{ color: cfg?.color ?? "oklch(0.52 0.012 245)" }} />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 text-xs">
                            <div className="text-foreground/90">{summarize(e, jobsById)}</div>
                            {showRaw && Object.keys(e.payload ?? {}).length > 0 && (
                              <pre className="mt-1.5 text-[10px] font-mono text-muted-foreground/60 whitespace-pre-wrap break-all bg-background/40 rounded px-2 py-1">
                                {JSON.stringify(e.payload, null, 2)}
                              </pre>
                            )}
                          </div>

                          {/* Relative time */}
                          <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">
                            {relTime(e.timestamp)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        ))}
      </div>
    </div>
  );
}

function summarize(e: DriverEvent, jobsById: Record<string, Job>): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const jobRef = (() => {
    const id = p.job_id as string | undefined;
    if (!id) return null;
    return jobsById[id]?.reference ?? id.slice(0, 8);
  })();
  switch (e.type) {
    case "START_SHIFT":       return "Started shift";
    case "END_SHIFT":         return p.had_active_route ? "Ended shift (had active route)" : "Ended shift";
    case "END_SHIFT_BLOCKED": return "Tried to end shift — blocked (active route)";
    case "LOCATION_UPDATE": {
      const lat = typeof p.lat === "number" ? p.lat.toFixed(4) : "?";
      const lon = typeof p.lon === "number" ? p.lon.toFixed(4) : "?";
      return `Location update (${lat}, ${lon})`;
    }
    case "ACCEPT_JOB":       return jobRef ? `Accepted job ${jobRef}` : "Accepted job";
    case "JOB_CARD_SENT":    return jobRef ? `Job card sent for ${jobRef}` : "Job card sent";
    case "DELAY_REPORT": {
      const reason = (p.reason as string) || "Delay reported";
      return jobRef ? `${reason} (job ${jobRef})` : reason;
    }
    case "CANT_COMPLETE":    return jobRef ? `Can't complete job ${jobRef}` : "Can't complete";
    default:                 return e.type.replace(/_/g, " ").toLowerCase();
  }
}

function relTime(ts: string): string {
  const diff = Date.now() - +new Date(ts);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
