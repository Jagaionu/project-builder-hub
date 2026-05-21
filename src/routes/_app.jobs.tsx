import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, useLayoutEffect, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useJobs, useWarehouses, useDrivers, useCompliance } from "@/lib/hooks";
import type { Compliance } from "@/lib/compliance";

import { PageHeader } from "./_app.index";
import { Plus, Trash2, X, ChevronUp, ChevronDown, MapPin, Clock, ChevronRight, Check, User, Upload, Calendar as CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyDriverOfJob } from "@/lib/telegram-notify.functions";
import { computePlan, AUTO_ASSIGN_RADIUS_KM } from "@/lib/planner";
import { computeStopSchedule, legMinutes } from "@/lib/geo";
import { importJobsCsv } from "@/lib/jobs-import.functions";
import { csvToImportRows } from "@/lib/csv-import";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

const ACTIVE_JOB_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);
void AUTO_ASSIGN_RADIUS_KM;
void ACTIVE_JOB_STATUSES;

// Compute & persist scheduled_at on a job's stops, anchored at jobStart.
// Only writes rows whose computed value differs from what's stored (skip nulls).
async function fillStopTimes(
  jobId: string,
  jobStart: string | null,
  stops: { id?: string; kind: "PICKUP" | "DROP"; warehouse_id: string; scheduled_at: string | null }[],
  warehouses: { id: string; latitude: number; longitude: number }[],
) {
  if (!jobStart || stops.length === 0) return;
  const times = computeStopSchedule(stops, jobStart, warehouses);
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const t = times[i];
    if (!s.id || !t) continue;
    if (s.scheduled_at === t) continue;
    await supabase.from("job_stops").update({ scheduled_at: t }).eq("id", s.id);
  }
}


export const Route = createFileRoute("/_app/jobs")({
  component: JobsPage,
  head: () => ({ meta: [{ title: "Jobs — Planning System" }] }),
});

function ImportCsvButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const runImport = useServerFn(importJobsCsv);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const rows = csvToImportRows(text);
      if (rows.length === 0) {
        toast.error("No rows found in CSV");
        return;
      }
      const res = await runImport({ data: { rows } });
      const parts: string[] = [`${res.created} created`];
      if (res.skippedDuplicate.length) parts.push(`${res.skippedDuplicate.length} duplicate`);
      if (res.skippedUnknownWh.length) parts.push(`${res.skippedUnknownWh.length} unknown warehouse`);
      if (res.errors.length) parts.push(`${res.errors.length} errors`);
      toast.success(parts.join(" · "));
      if (res.skippedUnknownWh.length) {
        const codes = Array.from(new Set(res.skippedUnknownWh.flatMap((r) => r.missing)));
        toast.message("Missing warehouse codes", { description: codes.join(", ") });
      }
      if (res.errors.length) {
        console.error("[csv-import] errors", res.errors);
      }
    } catch (err) {
      console.error("[csv-import]", err);
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onFile}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
      >
        <Upload className="size-3.5" /> {busy ? "Importing…" : "Import CSV"}
      </button>
    </>
  );
}


type Stop = {
  id?: string;
  kind: "PICKUP" | "DROP";
  warehouse_id: string;
  scheduled_at: string | null;
  arrived_at?: string | null;
};

type JobStopsMap = Record<string, Stop[]>;

function useJobStops(): JobStopsMap {
  const [map, setMap] = useState<JobStopsMap>({});
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("job_stops")
        .select("id,job_id,kind,warehouse_id,scheduled_at,arrived_at,seq")
        .order("seq", { ascending: true });
      if (!mounted) return;
      const m: JobStopsMap = {};
      for (const s of (data ?? []) as Array<{ job_id: string } & Stop & { seq: number }>) {
        (m[s.job_id] ||= []).push({
          id: s.id,
          kind: s.kind,
          warehouse_id: s.warehouse_id,
          scheduled_at: s.scheduled_at,
          arrived_at: s.arrived_at,
        });
      }
      setMap(m);
    };
    load();
    const ch = supabase
      .channel("rt-stops")
      .on("postgres_changes", { event: "*", schema: "public", table: "job_stops" }, () => load())
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return map;
}

const JOB_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
  "ARRIVED_PICKUP",
  "EN_ROUTE_DELIVERY",
  "COMPLETED",
  "CANCELLED",
] as const;

type JobStatus = (typeof JOB_STATUSES)[number];

const STATUS_CONFIG: Record<JobStatus, { label: string; dot: string; badge: string }> = {
  PENDING:           { label: "Pending",          dot: "bg-amber-400",   badge: "text-amber-500 bg-amber-500/10" },
  ASSIGNED:          { label: "Assigned",          dot: "bg-blue-400",    badge: "text-blue-500 bg-blue-500/10" },
  IN_PROGRESS:       { label: "In Progress",       dot: "bg-violet-400",  badge: "text-violet-500 bg-violet-500/10" },
  ARRIVED_PICKUP:    { label: "Arrived Pickup",    dot: "bg-cyan-400",    badge: "text-cyan-500 bg-cyan-500/10" },
  EN_ROUTE_DELIVERY: { label: "En Route Delivery", dot: "bg-indigo-400",  badge: "text-indigo-500 bg-indigo-500/10" },
  COMPLETED:         { label: "Completed",         dot: "bg-emerald-400", badge: "text-emerald-600 bg-emerald-500/10" },
  CANCELLED:         { label: "Cancelled",         dot: "bg-zinc-400",    badge: "text-zinc-400 bg-zinc-500/10" },
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtDateShort(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}
function jobDate(j: { scheduled_at: string | null; planned_start_at?: string | null; created_at: string }, stops: { scheduled_at: string | null }[]): Date {
  const firstStop = stops.find((s) => s.scheduled_at)?.scheduled_at;
  const iso = j.scheduled_at ?? j.planned_start_at ?? firstStop ?? j.created_at;
  return new Date(iso);
}


function JobsPage() {
  const jobs = useJobs();
  const warehouses = useWarehouses();
  const drivers = useDrivers();
  const stopsMap = useJobStops();
  const compliance = useCompliance();
  const [createOpen, setCreateOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<JobStatus>>(() => {
    if (typeof window === "undefined") return new Set<JobStatus>(["COMPLETED", "CANCELLED"]);
    try {
      const raw = localStorage.getItem("jobs.hiddenStatuses");
      if (raw) return new Set(JSON.parse(raw) as JobStatus[]);
    } catch { /* noop */ }
    return new Set<JobStatus>(["COMPLETED", "CANCELLED"]);
  });
  useEffect(() => {
    try { localStorage.setItem("jobs.hiddenStatuses", JSON.stringify(Array.from(hiddenStatuses))); }
    catch { /* noop */ }
  }, [hiddenStatuses]);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!statusMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) setStatusMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [statusMenuOpen]);
  function toggleStatus(s: JobStatus) {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }
  // Date range filter (defaults to today). Persisted in localStorage.
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = startOfDay(new Date());
    if (typeof window === "undefined") return { from: today, to: today };
    try {
      const raw = localStorage.getItem("jobs.dateRange");
      if (raw) {
        const p = JSON.parse(raw) as { from?: string; to?: string; mode?: "all" };
        if (p.mode === "all") return undefined;
        if (p.from) return { from: new Date(p.from), to: p.to ? new Date(p.to) : undefined };
      }
    } catch { /* noop */ }
    return { from: today, to: today };
  });
  useEffect(() => {
    try {
      if (!dateRange) localStorage.setItem("jobs.dateRange", JSON.stringify({ mode: "all" }));
      else localStorage.setItem("jobs.dateRange", JSON.stringify({
        from: dateRange.from?.toISOString(),
        to: dateRange.to?.toISOString(),
      }));
    } catch { /* noop */ }
  }, [dateRange]);
  const notify = useServerFn(notifyDriverOfJob);
  const plan = useMemo(
    () => computePlan(jobs, stopsMap, drivers, warehouses, compliance),
    [jobs, stopsMap, drivers, warehouses, compliance],
  );
  const plannedByJob = useMemo(
    () => new Map(plan.planned.map((item) => [item.jobId, item] as const)),
    [plan],
  );

  useEffect(() => {
    const inconsistent = jobs.filter((j) => !j.assigned_driver_id && ACTIVE_JOB_STATUSES.has(j.status));
    if (inconsistent.length === 0) return;
    void (async () => {
      for (const job of inconsistent) {
        const { error } = await supabase.from("jobs").update({ status: "PENDING" as never }).eq("id", job.id);
        if (error) console.error("[jobs] failed to normalize unassigned active job", job.id, error.message);
      }
    })();
  }, [jobs]);

  async function assignDriver(jobId: string, driverId: string) {
    if (driverId) {
      const c = compliance[driverId];
      if (c?.blockAssignment) {
        const reason = c.issues.find((i) => i.level === "breach")?.msg ?? "compliance breach";
        return toast.error(`Cannot assign: ${reason}`);
      }
    }
    const payload = driverId
      ? { assigned_driver_id: driverId, status: "ASSIGNED" as never }
      : { assigned_driver_id: null, status: "PENDING" as never };
    const { error } = await supabase.from("jobs").update(payload).eq("id", jobId);
    if (error) return toast.error(error.message);
    if (driverId) {
      try {
        const r = await notify({ data: { jobId } });
        if ((r as { skipped?: string }).skipped === "driver_no_telegram") toast.warning("Driver has no Telegram linked");
        else toast.success("Driver notified on Telegram");
      } catch (e) { toast.error(`Notify failed: ${(e as Error).message}`); }
    }
  }

  // Auto-planner: Pass 1 immediate assign, Pass 2 planned chaining, Pass 3 leftovers (alerts).
  // Re-runs on any change to jobs/stops/drivers/compliance. Writes only diffs.
  const planSigRef = useRef<string>("");
  useEffect(() => {
    if (drivers.length === 0 || warehouses.length === 0) return;
    // Wait until every PENDING job has its stops loaded
    const pending = jobs.filter((j) => j.status === "PENDING" && !j.assigned_driver_id);
    if (pending.some((j) => !stopsMap[j.id])) return;

    const plan = computePlan(jobs, stopsMap, drivers, warehouses, compliance);

    // Stable signature to avoid loops if the same plan is recomputed.
    const sig = JSON.stringify({
      i: plan.immediate.map((x) => [x.jobId, x.driverId]),
      p: plan.planned.map((x) => [x.jobId, x.driverId, x.sequence, x.startAt]),
    });
    if (sig === planSigRef.current) return;
    planSigRef.current = sig;

    (async () => {
      // Pass 1: immediate assignments (uses existing assignDriver path so Telegram notify fires)
      for (const a of plan.immediate) {
        const job = jobs.find((j) => j.id === a.jobId);
        const driver = drivers.find((d) => d.id === a.driverId);
        if (!job || !driver) continue;
        await assignDriver(a.jobId, a.driverId);
        toast.message(`Auto-assigned ${driver.name} → ${job.reference} (${a.distKm.toFixed(1)} km)`);
        // Auto-fill stop times starting from job.scheduled_at or now
        await fillStopTimes(a.jobId, job.scheduled_at ?? new Date().toISOString(), stopsMap[a.jobId] ?? [], warehouses);
      }

      // Pass 2: planned diffs
      const desired = new Map(
        plan.planned.map((p) => [p.jobId, { d: p.driverId, s: p.sequence, t: p.startAt }] as const),
      );
      for (const job of jobs) {
        const want = desired.get(job.id);
        const have = {
          d: job.planned_driver_id ?? null,
          s: job.planned_sequence ?? null,
          t: job.planned_start_at ?? null,
        };
        // Clear stale planned_* on jobs that are no longer pending OR no longer planned
        if (!want) {
          if (have.d || have.s || have.t) {
            await supabase
              .from("jobs")
              .update({
                planned_driver_id: null,
                planned_sequence: null,
                planned_start_at: null,
              })
              .eq("id", job.id);
          }
          continue;
        }
        if (have.d !== want.d || have.s !== want.s || have.t !== want.t) {
          await supabase
            .from("jobs")
            .update({
              planned_driver_id: want.d,
              planned_sequence: want.s,
              planned_start_at: want.t,
            })
            .eq("id", job.id);
          // Auto-fill stop times anchored at planned start
          await fillStopTimes(job.id, want.t, stopsMap[job.id] ?? [], warehouses);
        }
      }
    })();
    // Note: assignDriver excluded from deps — it's stable enough for this effect's purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, stopsMap, drivers, warehouses, compliance]);


  // status config moved to module level

  async function setStatus(jobId: string, status: string) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    const requiresDriver = ACTIVE_JOB_STATUSES.has(status);
    if (requiresDriver && !job.assigned_driver_id) {
      toast.error("Assign a driver before setting this route in progress");
      return;
    }
    const { error } = await supabase.from("jobs").update({ status: status as never }).eq("id", jobId);
    if (error) toast.error(error.message);
    else toast.success(`Status → ${STATUS_CONFIG[status as JobStatus]?.label ?? status}`);
  }

  const editingJob = editJobId ? jobs.find((j) => j.id === editJobId) : null;

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateRange?.from ? startOfDay(dateRange.from).getTime() : null;
    const to = dateRange ? endOfDay(dateRange.to ?? dateRange.from ?? new Date()).getTime() : null;
    return jobs.filter((j) => {
      if (hiddenStatuses.has(j.status as JobStatus)) return false;
      if (from !== null && to !== null) {
        const t = jobDate(j, stopsMap[j.id] ?? []).getTime();
        if (t < from || t > to) return false;
      }
      if (!q) return true;
      if (j.reference.toLowerCase().includes(q)) return true;
      if (j.status.toLowerCase().replace(/_/g, " ").includes(q)) return true;
      if ((STATUS_CONFIG[j.status as JobStatus]?.label ?? "").toLowerCase().includes(q)) return true;
      const stops = stopsMap[j.id] ?? [];
      const route = stops
        .map((s) => warehouses.find((w) => w.id === s.warehouse_id))
        .map((w) => `${w?.code ?? ""} ${w?.name ?? ""}`)
        .join(" ")
        .toLowerCase();
      if (route.includes(q)) return true;
      const driver = drivers.find((d) => d.id === j.assigned_driver_id);
      if (driver?.name.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [jobs, stopsMap, warehouses, drivers, search, hiddenStatuses, dateRange]);

  const dateLabel = useMemo(() => {
    if (!dateRange?.from) return "All dates";
    const today = startOfDay(new Date());
    const from = dateRange.from;
    const to = dateRange.to ?? from;
    if (sameDay(from, today) && sameDay(to, today)) return "Today";
    if (sameDay(from, to)) return fmtDateShort(from);
    return `${fmtDateShort(from)} – ${fmtDateShort(to)}`;
  }, [dateRange]);

  // Dates that have at least one job (from all loaded jobs, regardless of filters).
  const jobDays = useMemo(() => {
    const s = new Set<string>();
    for (const j of jobs) {
      const d = startOfDay(jobDate(j, stopsMap[j.id] ?? []));
      s.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return s;
  }, [jobs, stopsMap]);
  const hasJobsOn = (d: Date) => jobDays.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  const monthStart = startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const monthEnd = startOfDay(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Jobs"
        subtitle="Multi-stop routes — click a row to edit or delete"
        right={
          <div className="flex items-center gap-2">
            <ImportCsvButton />
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-3.5" /> Create route
            </button>
          </div>
        }
      />
        <div className="flex-1 overflow-y-auto p-5">
          {jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center">
              <MapPin className="size-8 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No routes yet.</p>
              <button
                onClick={() => setCreateOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="size-3.5" /> Create your first route
              </button>
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-surface-2",
                        dateRange ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="size-3.5" />
                      {dateLabel}
                      <ChevronDown className="size-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      <button
                        onClick={() => { const t = startOfDay(new Date()); setDateRange({ from: t, to: t }); }}
                        className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground"
                      >Today</button>
                      <button
                        onClick={() => { const y = startOfDay(new Date(Date.now() - 86400000)); setDateRange({ from: y, to: y }); }}
                        className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground"
                      >Yesterday</button>
                      <button
                        onClick={() => { const to = startOfDay(new Date()); const from = startOfDay(new Date(Date.now() - 6 * 86400000)); setDateRange({ from, to }); }}
                        className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground"
                      >7d</button>
                      <button
                        onClick={() => setDateRange(undefined)}
                        className="ml-auto rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground"
                      >All</button>
                    </div>
                    <Calendar
                      mode="range"
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={1}
                      startMonth={monthStart}
                      endMonth={monthEnd}
                      disabled={(d) => d < monthStart || d > monthEnd || !hasJobsOn(d)}
                      modifiers={{ hasJobs: (d) => hasJobsOn(d) }}
                      modifiersClassNames={{ hasJobs: "font-semibold underline underline-offset-4 decoration-primary/70" }}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by reference, route (warehouse code/name), driver, status…"
                  className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div ref={statusMenuRef} className="relative">
                  <button
                    onClick={() => setStatusMenuOpen((o) => !o)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-2"
                  >
                    Statuses
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {JOB_STATUSES.length - hiddenStatuses.size}/{JOB_STATUSES.length}
                    </span>
                    <ChevronDown className="size-3" />
                  </button>
                  {statusMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-md border border-border bg-surface shadow-lg overflow-hidden">
                      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        <span>Show statuses</span>
                        <div className="flex gap-2">
                          <button onClick={() => setHiddenStatuses(new Set())} className="hover:text-foreground">All</button>
                          <button onClick={() => setHiddenStatuses(new Set(JOB_STATUSES))} className="hover:text-foreground">None</button>
                        </div>
                      </div>
                      {JOB_STATUSES.map((s) => {
                        const shown = !hiddenStatuses.has(s);
                        return (
                          <label
                            key={s}
                            className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-surface-2 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={shown}
                              onChange={() => toggleStatus(s)}
                              className="size-3.5 accent-primary"
                            />
                            <span className={`size-1.5 rounded-full ${STATUS_CONFIG[s].dot}`} />
                            <span className="flex-1">{STATUS_CONFIG[s].label}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {jobs.filter((j) => j.status === s).length}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                {(search || hiddenStatuses.size !== 2 || !hiddenStatuses.has("COMPLETED") || !hiddenStatuses.has("CANCELLED") || !dateRange || !dateRange.from || !sameDay(dateRange.from, startOfDay(new Date())) || !sameDay(dateRange.to ?? dateRange.from, startOfDay(new Date()))) && (
                  <button
                    onClick={() => { const t = startOfDay(new Date()); setSearch(""); setHiddenStatuses(new Set<JobStatus>(["COMPLETED", "CANCELLED"])); setDateRange({ from: t, to: t }); }}
                    className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface-2"
                  >
                    Reset
                  </button>
                )}
                <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                  {filteredJobs.length} / {jobs.length}
                </span>
              </div>
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-3 px-4 py-2.5 bg-background border-b border-border text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                <div className="col-span-2">Reference</div>
                <div className="col-span-4">Route</div>
                <div className="col-span-2">Driver</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Scheduled / ETA</div>
              </div>
              {/* Rows */}
              {filteredJobs.map((j) => {
                const stops = stopsMap[j.id] ?? [];
                const planned = plannedByJob.get(j.id);
                return (
                  <div
                    key={j.id}
                    onClick={() => setEditJobId(j.id)}
                    className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-border last:border-b-0 items-center hover:bg-surface-2 cursor-pointer transition group"
                  >
                    <div className="col-span-2">
                      <div className="font-mono text-xs text-foreground">{j.reference}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{stops.length} stops</div>
                    </div>
                  <div className="col-span-4">
                    <div className="flex items-center gap-1 flex-wrap">
                      {stops.length === 0 ? (
                        <span className="text-xs text-muted-foreground/50 italic">No stops</span>
                      ) : (
                        stops.map((s, idx) => {
                          const wh = warehouses.find((w) => w.id === s.warehouse_id);
                          const code = wh?.code ?? "?";
                          const next = stops[idx + 1];
                          const nextWh = next ? warehouses.find((w) => w.id === next.warehouse_id) : null;
                          const leg = wh && nextWh ? legMinutes(s, wh, nextWh) : null;
                          return (
                            <span key={idx} className="flex items-center gap-1">
                              <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                                s.kind === "PICKUP"
                                  ? "bg-blue-500/10 text-blue-500"
                                  : "bg-emerald-500/10 text-emerald-600"
                              }`}>
                                {code}
                              </span>
                              {leg && (
                                <span className="flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground/70 px-1">
                                  {leg.loadingMin > 0 && (
                                    <span title="Loading at pickup" className="text-amber-500/80">+{leg.loadingMin}m load</span>
                                  )}
                                  <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
                                  <span title={`${leg.km.toFixed(1)} km`}>ETA {leg.transitMin}m</span>
                                  <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
                                </span>
                              )}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
                    <DriverPicker
                      driverId={j.assigned_driver_id}
                      allowUnassign={!ACTIVE_JOB_STATUSES.has(j.status)}
                      drivers={drivers}
                      compliance={compliance}
                      onChange={(id) => assignDriver(j.id, id)}
                    />
                    {!j.assigned_driver_id && (planned || j.planned_driver_id) && (
                      <PlannedChip
                        driverName={drivers.find((d) => d.id === (planned?.driverId ?? j.planned_driver_id))?.name ?? "?"}
                        sequence={planned?.sequence ?? j.planned_sequence ?? undefined}
                        startAt={planned?.startAt ?? j.planned_start_at ?? undefined}
                        distanceKm={planned?.distKm}
                        dailyHoursLeft={planned?.dailyHoursLeft}
                      />
                    )}
                  </div>

                    <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
                      <StatusPill
                        status={j.status}
                        onChange={(s) => setStatus(j.id, s)}
                      />
                    </div>
                    <div className="col-span-2 text-[11px] text-muted-foreground">
                      {j.scheduled_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {new Date(j.scheduled_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      {j.eta_minutes != null && (
                        <span className="font-mono">ETA {j.eta_minutes}m</span>
                      )}
                      {!j.scheduled_at && j.eta_minutes == null && (
                        <span>—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          )}
        </div>

      {createOpen && (
        <RouteDialog
          mode="create"
          onClose={() => setCreateOpen(false)}
          warehouses={warehouses}
        />
      )}
      {editingJob && (
        <RouteDialog
          mode="edit"
          jobId={editingJob.id}
          initial={{
            scheduled_at: editingJob.scheduled_at,
            stops: stopsMap[editingJob.id] ?? [],
          }}
          onClose={() => setEditJobId(null)}
          warehouses={warehouses}
        />
      )}
    </div>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, left: r.left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return { open, setOpen, ref, btnRef, popRef, coords };
}

function StatusPill({ status, onChange }: { status: string; onChange: (s: string) => void }) {
  const { open, setOpen, btnRef, popRef, coords } = usePopover();
  const cfg = STATUS_CONFIG[status as JobStatus] ?? STATUS_CONFIG.PENDING;
  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 select-none ${cfg.badge}`}
      >
        <span className={`size-1.5 rounded-full shrink-0 ${cfg.dot}`} />
        {cfg.label}
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-[1000] w-48 rounded-xl border border-border bg-popover shadow-xl py-1.5"
        >
          {JOB_STATUSES.map((s) => {
            const c = STATUS_CONFIG[s];
            const active = s === status;
            return (
              <button
                key={s}
                type="button"
                onClick={() => { onChange(s); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-surface-2 transition-colors"
              >
                <span className={`size-2 rounded-full shrink-0 ${c.dot}`} />
                <span className={`flex-1 text-left ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {c.label}
                </span>
                {active && <Check className="size-3 text-foreground" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

function DriverPicker({ driverId, allowUnassign = true, drivers, compliance, onChange }: {
  driverId: string | null | undefined;
  allowUnassign?: boolean;
  drivers: { id: string; name: string; telegram_id?: string | null; status?: string }[];
  compliance?: Record<string, Compliance>;
  onChange: (id: string) => void;
}) {
  const { open, setOpen, btnRef, popRef, coords } = usePopover();
  const driver = drivers.find((d) => d.id === driverId);
  const activeC = driver ? compliance?.[driver.id] : undefined;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        {driver ? (
          <>
            <span className="size-6 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
              {driver.name[0]?.toUpperCase()}
            </span>
            <span className="text-xs text-foreground font-medium truncate max-w-[90px]">{driver.name}</span>
            {activeC && <ComplianceDot c={activeC} />}
            {!driver.telegram_id && <span className="text-[9px] text-muted-foreground/60 font-mono">no TG</span>}
          </>
        ) : (
          <>
            <span className="size-6 rounded-full border border-dashed border-border flex items-center justify-center shrink-0">
              <User className="size-3 text-muted-foreground/50" />
            </span>
            <span className="text-xs text-muted-foreground">Unassigned</span>
          </>
        )}
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-[1000] w-52 rounded-xl border border-border bg-popover shadow-xl py-1.5 max-h-[60vh] overflow-y-auto"
        >
          {allowUnassign && (
            <>
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-surface-2 transition-colors"
              >
                <span className="size-6 rounded-full border border-dashed border-border flex items-center justify-center shrink-0">
                  <User className="size-3 text-muted-foreground/40" />
                </span>
                <span className={`flex-1 text-left ${!driverId ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  Unassigned
                </span>
                {!driverId && <Check className="size-3 text-foreground" />}
              </button>
              {drivers.length > 0 && <div className="my-1 border-t border-border/50" />}
            </>
          )}
          {drivers.map((d) => {
            const active = d.id === driverId;
            const dc = compliance?.[d.id];
            const blocked = !!dc?.blockAssignment;
            return (
              <button
                key={d.id}
                type="button"
                disabled={blocked}
                onClick={() => { if (!blocked) { onChange(d.id); setOpen(false); } }}
                title={blocked ? dc?.issues.find((i) => i.level === "breach")?.msg : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${blocked ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-2"}`}
              >
                <span className="size-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                  {d.name[0]?.toUpperCase()}
                </span>
                <span className={`flex-1 text-left ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {d.name}
                  {!d.telegram_id && <span className="ml-1 text-[9px] text-muted-foreground/50">no TG</span>}
                  {dc && (
                    <span className="ml-1 text-[9px] font-mono text-muted-foreground/70">
                      {dc.weekly.toFixed(0)}/56 · {dc.dailyHeadroom.toFixed(1)}h left
                    </span>
                  )}
                </span>
                {dc && <ComplianceDot c={dc} />}
                {active && <Check className="size-3 text-foreground" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

function RouteDialog({
  mode,
  jobId,
  initial,
  onClose,
  warehouses,
}: {
  mode: "create" | "edit";
  jobId?: string;
  initial?: { scheduled_at: string | null; stops: Stop[] };
  onClose: () => void;
  warehouses: ReturnType<typeof useWarehouses>;
}) {
  // Default scheduled time to "now" on create so the planner can compute ETAs immediately
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduled_at
      ? toLocalInput(initial.scheduled_at)
      : mode === "create"
        ? toLocalInput(new Date().toISOString())
        : "",
  );
  const [stops, setStops] = useState<Stop[]>(
    initial?.stops?.length
      ? initial.stops.map((s) => ({ ...s, scheduled_at: s.scheduled_at }))
      : [
          { kind: "PICKUP", warehouse_id: "", scheduled_at: null },
          { kind: "DROP", warehouse_id: "", scheduled_at: null },
        ],
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Auto-compute each stop's scheduled_at from jobStart + transit + loading
  const startIso = scheduledAt ? new Date(scheduledAt).toISOString() : null;
  const computedTimes = computeStopSchedule(stops, startIso, warehouses);

  function update(i: number, patch: Partial<Stop>) {
    setStops((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function move(i: number, dir: -1 | 1) {
    setStops((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }
  function addStop(kind: "PICKUP" | "DROP") {
    setStops((prev) => [...prev, { kind, warehouse_id: "", scheduled_at: null }]);
  }
  function removeStop(i: number) {
    setStops((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stops.length < 2) return toast.error("Need at least 2 stops");
    if (stops.some((s) => !s.warehouse_id)) return toast.error("Every stop needs a warehouse");
    setSaving(true);

    const jobStartIso = scheduledAt ? new Date(scheduledAt).toISOString() : new Date().toISOString();
    const autoTimes = computeStopSchedule(stops, jobStartIso, warehouses);

    const jobPayload = {
      scheduled_at: jobStartIso,
      origin_warehouse_id: stops[0].warehouse_id,
      destination_warehouse_id: stops[stops.length - 1].warehouse_id,
    };

    let targetJobId = jobId;
    if (mode === "create") {
      const { data, error } = await supabase
        .from("jobs").insert(jobPayload as never).select("id").single();
      if (error) { setSaving(false); console.error("[jobs.insert]", error); return toast.error(`Job create failed: ${error.message}`); }
      targetJobId = (data as { id: string }).id;
    } else {
      const { error } = await supabase.from("jobs").update(jobPayload).eq("id", targetJobId!);
      if (error) { setSaving(false); console.error("[jobs.update]", error); return toast.error(`Job update failed: ${error.message}`); }
    }

    // Replace stops — use computed times when user didn't enter one
    const { error: delErr } = await supabase.from("job_stops").delete().eq("job_id", targetJobId!);
    if (delErr) { setSaving(false); console.error("[stops.delete]", delErr); return toast.error(`Clear stops failed: ${delErr.message}`); }

    const rows = stops.map((s, i) => ({
      job_id: targetJobId!,
      seq: i,
      kind: s.kind as never,
      warehouse_id: s.warehouse_id,
      scheduled_at: s.scheduled_at ?? autoTimes[i] ?? null,
    }));
    const { error: stopErr } = await supabase.from("job_stops").insert(rows as never);
    setSaving(false);
    if (stopErr) { console.error("[stops.insert]", stopErr, rows); return toast.error(`Stops insert failed: ${stopErr.message}`); }

    toast.success(mode === "create" ? "Route created" : "Route updated");
    onClose();
  }

  async function onDelete() {
    if (!jobId) return;
    if (!confirm("Delete this lane? This cannot be undone.")) return;
    setDeleting(true);
    const { error } = await supabase.from("jobs").delete().eq("id", jobId);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success("Lane deleted");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-lg border border-border bg-surface shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">{mode === "create" ? "Create route" : "Edit route"}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <Field label="Scheduled (optional)">
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm" />
            </Field>
            <p className="mt-2 text-[11px] text-muted-foreground">Driver is assigned from the jobs list once the route is created.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Stops</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => addStop("PICKUP")} className="text-xs rounded border border-border px-2 py-1 hover:bg-surface-2">+ Pickup</button>
                <button type="button" onClick={() => addStop("DROP")} className="text-xs rounded border border-border px-2 py-1 hover:bg-surface-2">+ Drop</button>
              </div>
            </div>
            <div className="space-y-2">
              {stops.map((s, i) => {
                const auto = computedTimes[i];
                const showAuto = !s.scheduled_at && auto;
                return (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
                    <span className="font-mono text-xs text-muted-foreground w-6 text-right">{i + 1}.</span>
                    <select
                      value={s.kind}
                      onChange={(e) => update(i, { kind: e.target.value as "PICKUP" | "DROP" })}
                      className="bg-surface border border-border rounded px-2 py-1 text-xs"
                    >
                      <option value="PICKUP">📦 Pickup</option>
                      <option value="DROP">🏁 Drop</option>
                    </select>
                    <select
                      required
                      value={s.warehouse_id}
                      onChange={(e) => update(i, { warehouse_id: e.target.value })}
                      className="flex-1 bg-surface border border-border rounded px-2 py-1 text-xs"
                    >
                      <option value="">Select warehouse…</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                    </select>
                    <div className="flex flex-col items-end">
                      <input
                        type="datetime-local"
                        value={s.scheduled_at ? toLocalInput(s.scheduled_at) : auto ? toLocalInput(auto) : ""}
                        onChange={(e) => update(i, { scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                        className={`bg-surface border border-border rounded px-2 py-1 text-xs ${showAuto ? "text-muted-foreground italic" : ""}`}
                        title={showAuto ? "Auto-calculated from previous stop + driving + loading" : "Time window for this stop"}
                      />
                      {showAuto && (
                        <span className="text-[9px] font-mono text-muted-foreground/70 mt-0.5">auto</span>
                      )}
                    </div>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 hover:bg-surface-2 rounded disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === stops.length - 1} className="p-1 hover:bg-surface-2 rounded disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                    <button type="button" onClick={() => removeStop(i)} disabled={stops.length <= 2} className="p-1 hover:bg-destructive/20 rounded disabled:opacity-30"><Trash2 className="size-3.5" /></button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex justify-between gap-2 px-5 py-3 border-t border-border bg-surface-2/30">
          <div>
            {mode === "edit" && (
              <button type="button" onClick={onDelete} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 text-destructive px-3 py-1.5 text-xs hover:bg-destructive/20 disabled:opacity-50">
                <Trash2 className="size-3.5" /> {deleting ? "Deleting…" : "Delete lane"}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs hover:bg-surface-2">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving ? "Saving…" : mode === "create" ? "Create route" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function PlannedChip({
  driverName,
  sequence,
  startAt,
  distanceKm,
  dailyHoursLeft,
}: {
  driverName: string;
  sequence?: number;
  startAt?: string;
  distanceKm?: number;
  dailyHoursLeft?: number;
}) {
  const when = startAt
    ? new Date(startAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return (
    <div
      title="Planned follow-on assignment — not confirmed yet"
      className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
    >
      <span className="size-1 rounded-full bg-muted-foreground/60" />
      planned: {driverName}
      {sequence ? ` · #${sequence}` : ""}
      {when ? ` · ${when}` : ""}
      {distanceKm != null ? ` · ${distanceKm.toFixed(0)}km away` : ""}
      {dailyHoursLeft != null ? ` · ${dailyHoursLeft.toFixed(1)}h left` : ""}
    </div>
  );
}


function ComplianceDot({ c }: { c: Compliance }) {
  const offShift = !c.onShift;
  const cls = offShift
    ? "bg-muted-foreground/40"
    : c.status === "breach"
      ? "bg-destructive"
      : c.status === "warn"
        ? "bg-warning"
        : "bg-success";
  const title = offShift
    ? `Off shift · ${c.restHours === Infinity ? "—" : c.restHours.toFixed(1) + "h rest"}`
    : (c.issues[0]?.msg ?? `OK · ${c.daily.toFixed(1)}/10 today · ${c.weekly.toFixed(1)}/56 this week`);
  return <span title={title} className={`size-1.5 rounded-full shrink-0 ${cls}`} />;
}

