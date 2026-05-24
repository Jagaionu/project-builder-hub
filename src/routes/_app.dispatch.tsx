import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, useLayoutEffect, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useJobs, useWarehouses, useDrivers, useCompliance } from "@/lib/hooks";
import type { Compliance } from "@/lib/compliance";


import {
  Plus, Trash2, X, ChevronUp, ChevronDown, MapPin, Clock,
  Check, User, Upload, Calendar as CalendarIcon, Pencil, Sparkles, ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { toast } from "sonner";

import { computePlan, AUTO_ASSIGN_RADIUS_KM } from "@/lib/planner";
import { planTomorrow } from "@/lib/tomorrow.functions";
import { computeStopSchedule, stopDwellMinutes, haversineKm, etaMinutes } from "@/lib/geo";
import { isJobScheduledFuture } from "@/lib/effective-status";
import { importJobsCsv } from "@/lib/jobs-import.functions";
import { csvToImportRows } from "@/lib/csv-import";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

const ACTIVE_JOB_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);
void AUTO_ASSIGN_RADIUS_KM;

async function fillStopTimes(
  jobId: string,
  jobStart: string | null,
  stops: { id?: string; kind: "PICKUP" | "DROP"; warehouse_id: string; scheduled_at: string | null }[],
  warehouses: { id: string; latitude: number; longitude: number }[],
) {
  void jobId;
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

export const Route = createFileRoute("/_app/dispatch")({
  component: DispatchPage,
  head: () => ({ meta: [{ title: "Dispatch — Planning System" }] }),
});

// ── Types ────────────────────────────────────────────────────────────────────

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
  "PENDING", "ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP",
  "EN_ROUTE_DELIVERY", "COMPLETED", "CANCELLED",
] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

const STATUS_CONFIG: Record<JobStatus | "SCHEDULED", { label: string; dot: string; badge: string; color: string }> = {
  PENDING:           { label: "Pending",           dot: "bg-amber-400",   badge: "text-amber-500 bg-amber-500/10",     color: "oklch(0.80 0.18 72)" },
  ASSIGNED:          { label: "Assigned",          dot: "bg-blue-400",    badge: "text-blue-500 bg-blue-500/10",       color: "oklch(0.68 0.16 230)" },
  IN_PROGRESS:       { label: "In Progress",       dot: "bg-violet-400",  badge: "text-violet-500 bg-violet-500/10",   color: "oklch(0.62 0.22 245)" },
  ARRIVED_PICKUP:    { label: "Arrived Pickup",    dot: "bg-cyan-400",    badge: "text-cyan-500 bg-cyan-500/10",       color: "oklch(0.80 0.18 72)" },
  EN_ROUTE_DELIVERY: { label: "En Route Delivery", dot: "bg-indigo-400",  badge: "text-indigo-500 bg-indigo-500/10",   color: "oklch(0.75 0.18 245)" },
  COMPLETED:         { label: "Completed",         dot: "bg-emerald-400", badge: "text-emerald-600 bg-emerald-500/10", color: "oklch(0.73 0.17 150)" },
  CANCELLED:         { label: "Cancelled",         dot: "bg-zinc-400",    badge: "text-zinc-400 bg-zinc-500/10",       color: "oklch(0.52 0.012 245)" },
  SCHEDULED:         { label: "Scheduled",         dot: "bg-sky-400",     badge: "text-sky-500 bg-sky-500/10",         color: "oklch(0.68 0.16 230)" },
};

// ── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
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

// ── Toolbar buttons ──────────────────────────────────────────────────────────

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
      if (rows.length === 0) { toast.error("No rows found in CSV"); return; }
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
      if (res.errors.length) console.error("[csv-import] errors", res.errors);
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
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      <ToolbarButton onClick={() => inputRef.current?.click()} disabled={busy} icon={<Upload className="size-3.5" />}>
        {busy ? "Importing…" : "Import CSV"}
      </ToolbarButton>
    </>
  );
}

function ToolbarButton({
  onClick, disabled, icon, children, primary, title,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        primary
          ? "bg-gradient-to-b from-primary to-primary/85 text-primary-foreground shadow-[0_1px_0_oklch(1_0_0/0.18)_inset,0_4px_12px_oklch(0.62_0.22_245/0.35)] hover:shadow-[0_1px_0_oklch(1_0_0/0.2)_inset,0_6px_18px_oklch(0.62_0.22_245/0.5)] hover:-translate-y-px"
          : "bg-surface border border-border text-foreground hover:bg-surface-2 hover:border-border/70 shadow-sm",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function DispatchPage() {
  const jobs = useJobs();
  const warehouses = useWarehouses();
  const drivers = useDrivers();
  const stopsMap = useJobStops();
  const compliance = useCompliance();
  const [createOpen, setCreateOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [hiddenStatuses, setHiddenStatuses] = useState<Set<JobStatus>>(() => {
    if (typeof window === "undefined") return new Set<JobStatus>(["COMPLETED", "CANCELLED"]);
    try {
      const raw = localStorage.getItem("dispatch.hiddenStatuses");
      if (raw) return new Set(JSON.parse(raw) as JobStatus[]);
    } catch { /* noop */ }
    return new Set<JobStatus>(["COMPLETED", "CANCELLED"]);
  });
  useEffect(() => {
    try { localStorage.setItem("dispatch.hiddenStatuses", JSON.stringify(Array.from(hiddenStatuses))); }
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

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = startOfDay(new Date());
    if (typeof window === "undefined") return { from: today, to: today };
    try {
      const raw = localStorage.getItem("dispatch.dateRange");
      if (raw) {
        const p = JSON.parse(raw) as { mode?: "all"; from?: string; to?: string };
        if (p.mode === "all") return undefined;
        if (p.from) {
          const from = new Date(p.from);
          const to = p.to ? new Date(p.to) : from;
          if (!isNaN(from.getTime()) && !isNaN(to.getTime())) return { from, to };
        }
      }
    } catch { /* noop */ }
    return { from: today, to: today };
  });
  useEffect(() => {
    try {
      if (!dateRange) localStorage.setItem("dispatch.dateRange", JSON.stringify({ mode: "all" }));
      else if (dateRange.from) {
        localStorage.setItem("dispatch.dateRange", JSON.stringify({
          from: dateRange.from.toISOString(),
          to: (dateRange.to ?? dateRange.from).toISOString(),
        }));
      }
    } catch { /* noop */ }
  }, [dateRange]);

  const [statusFilter, setStatusFilter] = useState<JobStatus | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("dispatch.statusFilter");
      if (raw) {
        const parsed = JSON.parse(raw) as JobStatus | null;
        if (parsed && (JOB_STATUSES as readonly string[]).includes(parsed)) return parsed;
      }
    } catch { /* noop */ }
    return null;
  });
  useEffect(() => {
    try {
      if (statusFilter) localStorage.setItem("dispatch.statusFilter", JSON.stringify(statusFilter));
      else localStorage.removeItem("dispatch.statusFilter");
    } catch { /* noop */ }
  }, [statusFilter]);

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
        if (error) console.error("[dispatch] failed to normalize unassigned active job", job.id, error.message);
      }
    })();
  }, [jobs]);

  async function assignDriver(jobId: string, driverId: string, opts?: { manual?: boolean }) {
    if (driverId) {
      const c = compliance[driverId];
      if (c?.blockAssignment) {
        const reason = c.issues.find((i) => i.level === "breach")?.msg ?? "compliance breach";
        return toast.error(`Cannot assign: ${reason}`);
      }
    }
    const job = jobs.find((j) => j.id === jobId);
    const wasActive = job ? ACTIVE_JOB_STATUSES.has(job.status) : false;
    if (!driverId && opts?.manual && wasActive) {
      if (typeof window !== "undefined" && !window.confirm("Remove driver from this active job? It will go back to Pending.")) return;
    }
    const base = driverId
      ? { assigned_driver_id: driverId, status: "ASSIGNED" as never }
      : { assigned_driver_id: null, status: "PENDING" as never, planned_driver_id: null, planned_sequence: null, planned_start_at: null };
    const payload = opts?.manual ? { ...base, manual_override: true } : base;
    const { error } = await supabase.from("jobs").update(payload as never).eq("id", jobId);
    if (error) return toast.error(error.message);
    if (driverId) toast.success(opts?.manual ? "Driver assigned (manual)" : "Driver assigned");
    else if (opts?.manual) toast.success("Driver removed — auto-planner paused for this job");
  }

  // Auto-planner — unchanged from prior Jobs page
  const planSigRef = useRef<string>("");
  useEffect(() => {
    if (drivers.length === 0 || warehouses.length === 0) return;
    const pending = jobs.filter((j) => j.status === "PENDING" && !j.assigned_driver_id);
    if (pending.some((j) => !stopsMap[j.id])) return;

    const jobsForPlanner = jobs.filter((j) => !(j as { manual_override?: boolean }).manual_override);
    const p = computePlan(jobsForPlanner, stopsMap, drivers, warehouses, compliance);

    const sig = JSON.stringify({
      i: p.immediate.map((x) => [x.jobId, x.driverId]),
      p: p.planned.map((x) => [x.jobId, x.driverId, x.sequence, x.startAt]),
    });
    if (sig === planSigRef.current) return;
    planSigRef.current = sig;

    (async () => {
      for (const a of p.immediate) {
        const job = jobs.find((j) => j.id === a.jobId);
        const driver = drivers.find((d) => d.id === a.driverId);
        if (!job || !driver) continue;
        if ((job as { manual_override?: boolean }).manual_override) continue;
        await assignDriver(a.jobId, a.driverId);
        toast.message(`Auto-assigned ${driver.name} → ${job.reference} (${a.distKm.toFixed(1)} km)`);
        await fillStopTimes(a.jobId, job.scheduled_at ?? new Date().toISOString(), stopsMap[a.jobId] ?? [], warehouses);
      }
      const desired = new Map(p.planned.map((pp) => [pp.jobId, { d: pp.driverId, s: pp.sequence, t: pp.startAt }] as const));
      for (const job of jobs) {
        if ((job as { manual_override?: boolean }).manual_override) continue;
        const want = desired.get(job.id);
        const have = { d: job.planned_driver_id ?? null, s: job.planned_sequence ?? null, t: job.planned_start_at ?? null };
        if (!want) {
          if (have.d || have.s || have.t) {
            await supabase.from("jobs")
              .update({ planned_driver_id: null, planned_sequence: null, planned_start_at: null })
              .eq("id", job.id);
          }
          continue;
        }
        if (have.d !== want.d || have.s !== want.s || have.t !== want.t) {
          await supabase.from("jobs")
            .update({ planned_driver_id: want.d, planned_sequence: want.s, planned_start_at: want.t })
            .eq("id", job.id);
          await fillStopTimes(job.id, want.t, stopsMap[job.id] ?? [], warehouses);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, stopsMap, drivers, warehouses, compliance]);

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

  // Jobs filtered by date range + search only (used to compute status box counts).
  const jobsInRange = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateRange?.from ? startOfDay(dateRange.from).getTime() : null;
    const to = dateRange ? endOfDay(dateRange.to ?? dateRange.from ?? new Date()).getTime() : null;
    return jobs.filter((j) => {
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
        .join(" ").toLowerCase();
      if (route.includes(q)) return true;
      const driver = drivers.find((d) => d.id === j.assigned_driver_id);
      if (driver?.name.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [jobs, stopsMap, warehouses, drivers, search, dateRange]);

  const filteredJobs = useMemo(() => {
    return jobsInRange
      .filter((j) => {
        if (statusFilter) return j.status === statusFilter;
        return !hiddenStatuses.has(j.status as JobStatus);
      })
      .sort((a, b) => {
        const ta = jobDate(a, stopsMap[a.id] ?? []).getTime();
        const tb = jobDate(b, stopsMap[b.id] ?? []).getTime();
        return ta - tb;
      });
  }, [jobsInRange, hiddenStatuses, statusFilter, stopsMap]);

  const statusCounts = useMemo(() => {
    const c: Record<JobStatus, number> = {
      PENDING: 0, ASSIGNED: 0, IN_PROGRESS: 0, ARRIVED_PICKUP: 0,
      EN_ROUTE_DELIVERY: 0, COMPLETED: 0, CANCELLED: 0,
    };
    for (const j of jobsInRange) c[j.status as JobStatus] = (c[j.status as JobStatus] ?? 0) + 1;
    return c;
  }, [jobsInRange]);

  // Keep selection valid; default to first filtered job
  useEffect(() => {
    if (selectedJobId && filteredJobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(filteredJobs[0]?.id ?? null);
  }, [filteredJobs, selectedJobId]);

  const selectedJob = filteredJobs.find((j) => j.id === selectedJobId) ?? null;

  const dateLabel = useMemo(() => {
    if (!dateRange?.from) return "All dates";
    const today = startOfDay(new Date());
    const from = dateRange.from;
    const to = dateRange.to ?? from;
    if (sameDay(from, today) && sameDay(to, today)) return "Today";
    if (sameDay(from, to)) return fmtDateShort(from);
    return `${fmtDateShort(from)} – ${fmtDateShort(to)}`;
  }, [dateRange]);

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

  const tomorrowStats = useMemo(() => {
    const tm = startOfDay(new Date(Date.now() + 86400000));
    const tmJobs = jobs.filter((j) => sameDay(jobDate(j, stopsMap[j.id] ?? []), tm));
    const assigned = tmJobs.filter((j) => j.planned_driver_id || j.assigned_driver_id);
    const availableDrivers = drivers.filter((d) => (d as { available_tomorrow?: boolean }).available_tomorrow === true);
    const isTomorrowView = !!dateRange?.from && sameDay(dateRange.from, tm) && sameDay(dateRange.to ?? dateRange.from, tm);
    return { total: tmJobs.length, assigned: assigned.length, availableDrivers, isTomorrowView };
  }, [jobs, stopsMap, drivers, dateRange]);

  const [planningTomorrow, setPlanningTomorrow] = useState(false);
  const runPlanTomorrow = useServerFn(planTomorrow);
  async function onPlanTomorrow() {
    if (planningTomorrow) return;
    setPlanningTomorrow(true);
    try {
      const r = await runPlanTomorrow();
      const msg = `Planned ${r.assigned}/${r.totalJobs} routes · ${r.driversPlanned} drivers`;
      if (r.unassignable.length) toast.warning(`${msg} · ${r.unassignable.length} unassignable`);
      else toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlanningTomorrow(false);
    }
  }

  const today = startOfDay(new Date());
  const isDefaultFilters =
    !search &&
    !statusFilter &&
    hiddenStatuses.size === 2 &&
    hiddenStatuses.has("COMPLETED") &&
    hiddenStatuses.has("CANCELLED") &&
    !!dateRange?.from &&
    sameDay(dateRange.from, today) &&
    sameDay(dateRange.to ?? dateRange.from, today);

  const STATUS_BOX_KEYS: JobStatus[] = ["PENDING", "ASSIGNED", "COMPLETED", "CANCELLED"];

  const statusBoxesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!statusFilter) return;
    const h = (e: MouseEvent) => {
      if (statusBoxesRef.current && !statusBoxesRef.current.contains(e.target as Node)) {
        setStatusFilter(null);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [statusFilter]);

  return (
    <div className="h-full flex flex-col">
      <header className="px-5 py-3 border-b border-border grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Dispatch</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filteredJobs.length} shown of {jobs.length} total
          </p>
        </div>
        <div ref={statusBoxesRef} className="flex items-center gap-2 justify-self-center">
          {STATUS_BOX_KEYS.map((s) => {
            const active = statusFilter === s;
            const cfg = STATUS_CONFIG[s];
            return (
              <DispatchStat
                key={s}
                label={cfg.label}
                value={statusCounts[s] ?? 0}
                color={cfg.color}
                active={active}
                onClick={() => setStatusFilter(active ? null : s)}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2 justify-self-end">
          <ToolbarButton
            onClick={onPlanTomorrow}
            disabled={planningTomorrow || tomorrowStats.total === 0}
            title={tomorrowStats.total === 0 ? "No jobs scheduled for tomorrow" : "Auto-assign tomorrow's routes and notify drivers"}
            icon={<Sparkles className="size-3.5" />}
          >
            {planningTomorrow ? "Planning…" : "Plan Tomorrow"}
          </ToolbarButton>
          <ImportCsvButton />
          <ToolbarButton onClick={() => setCreateOpen(true)} primary icon={<Plus className="size-3.5" />}>
            Create route
          </ToolbarButton>
        </div>
      </header>

      {/* Filter bar */}
      <div className="px-5 py-3 border-b border-border bg-background/40 flex items-center gap-2">
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
              <button onClick={() => { const t = startOfDay(new Date()); setDateRange({ from: t, to: t }); }} className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground">Today</button>
              <button onClick={() => { const y = startOfDay(new Date(Date.now() - 86400000)); setDateRange({ from: y, to: y }); }} className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground">Yesterday</button>
              <button onClick={() => { const tm = startOfDay(new Date(Date.now() + 86400000)); setDateRange({ from: tm, to: tm }); }} className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground">Tomorrow</button>
              <button onClick={() => { const to = startOfDay(new Date()); const from = startOfDay(new Date(Date.now() - 6 * 86400000)); setDateRange({ from, to }); }} className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground">7d</button>
              <button onClick={() => setDateRange(undefined)} className="ml-auto rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground">All</button>
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
          placeholder="Search by reference, route, driver, status…"
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
                  <label key={s} className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-surface-2 cursor-pointer">
                    <input type="checkbox" checked={shown} onChange={() => toggleStatus(s)} className="size-3.5 accent-primary" />
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

        {!isDefaultFilters && (
          <button
            onClick={() => { const t = startOfDay(new Date()); setSearch(""); setStatusFilter(null); setHiddenStatuses(new Set<JobStatus>(["COMPLETED", "CANCELLED"])); setDateRange({ from: t, to: t }); }}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface-2"
          >
            Reset
          </button>
        )}
      </div>

      {tomorrowStats.isTomorrowView && tomorrowStats.total > 0 && (
        <div className="mx-5 mt-3 rounded-md border border-border bg-surface px-3 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Tomorrow coverage</span>
            <span className="font-mono">
              <span className={tomorrowStats.assigned === tomorrowStats.total ? "text-success" : "text-warning"}>
                {tomorrowStats.assigned}
              </span>
              <span className="text-muted-foreground"> / {tomorrowStats.total} routes assigned</span>
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-muted-foreground">
              {tomorrowStats.availableDrivers.length} driver{tomorrowStats.availableDrivers.length === 1 ? "" : "s"} available
            </span>
          </div>
          <button onClick={onPlanTomorrow} disabled={planningTomorrow} className="text-primary hover:underline disabled:opacity-50">
            {planningTomorrow ? "Planning…" : "Re-run planner"}
          </button>
        </div>
      )}

      {/* Two-column body */}
      <div className="flex-1 min-h-0 grid grid-cols-[360px_1fr]">
        {/* Queue */}
        <div className="border-r border-border overflow-y-auto bg-surface">
          <div className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border sticky top-0 bg-surface z-10">
            Queue · {filteredJobs.length}
          </div>
          {filteredJobs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              <MapPin className="size-8 mx-auto text-muted-foreground/40 mb-2" />
              {jobs.length === 0 ? "No routes yet." : "No routes match your filters."}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredJobs.map((j) => {
                const stops = stopsMap[j.id] ?? [];
                const o = warehouses.find((w) => w.id === stops[0]?.warehouse_id);
                const d = warehouses.find((w) => w.id === stops[stops.length - 1]?.warehouse_id);
                const driver = drivers.find((dr) => dr.id === j.assigned_driver_id);
                const planned = plannedByJob.get(j.id);
                const plannedDriver = !driver && (planned || j.planned_driver_id)
                  ? drivers.find((dr) => dr.id === (planned?.driverId ?? j.planned_driver_id))
                  : null;
                const isMR = stops.length > 2;
                const effectiveStatus = isJobScheduledFuture(
                  {
                    ...j,
                    stops: stops.map((s, idx) => ({
                      seq: idx, kind: s.kind, warehouse_id: s.warehouse_id,
                      scheduled_at: s.scheduled_at, arrived_at: s.arrived_at ?? null,
                    })),
                  },
                  Date.now(),
                ) ? "SCHEDULED" : (j.status as JobStatus);
                const cfg = STATUS_CONFIG[effectiveStatus];
                const active = selectedJobId === j.id;
                return (
                  <li key={j.id}>
                    <button
                      onClick={() => setSelectedJobId(j.id)}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-surface-2 transition",
                        active && "bg-surface-2 border-l-2 border-primary pl-[14px]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-xs text-muted-foreground truncate">{j.reference}</div>
                        <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-medium", cfg.badge)}>
                          <span className={cn("size-1.5 rounded-full", cfg.dot)} />
                          {cfg.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-sm font-mono">
                        <span className="truncate">{o?.code ?? "?"}</span>
                        <ArrowRight className="size-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{d?.code ?? "?"}</span>
                        {isMR && <span className="ml-1 text-[9px] font-mono text-amber-500">+{stops.length - 2}</span>}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {j.scheduled_at
                            ? new Date(j.scheduled_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                            : "ASAP"}
                        </span>
                        <span className="truncate ml-2">
                          {driver ? driver.name : plannedDriver ? `· planned: ${plannedDriver.name}` : "Unassigned"}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Detail panel */}
        <div className="overflow-y-auto">
          {!selectedJob ? (
            <div className="h-full grid place-items-center text-muted-foreground text-sm">
              Select a route from the queue
            </div>
          ) : (
            <JobDetailPanel
              key={selectedJob.id}
              job={selectedJob}
              stops={stopsMap[selectedJob.id] ?? []}
              warehouses={warehouses}
              drivers={drivers}
              compliance={compliance}
              planned={plannedByJob.get(selectedJob.id) ?? null}
              onAssignDriver={(id) => assignDriver(selectedJob.id, id, { manual: true })}
              onSetStatus={(s) => setStatus(selectedJob.id, s)}
              onEdit={() => setEditJobId(selectedJob.id)}
            />
          )}
        </div>
      </div>

      {createOpen && (
        <RouteDialog mode="create" onClose={() => setCreateOpen(false)} warehouses={warehouses} />
      )}
      {editingJob && (
        <RouteDialog
          mode="edit"
          jobId={editingJob.id}
          initial={{ scheduled_at: editingJob.scheduled_at, stops: stopsMap[editingJob.id] ?? [] }}
          onClose={() => setEditJobId(null)}
          warehouses={warehouses}
        />
      )}
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function JobDetailPanel({
  job, stops, warehouses, drivers, compliance, planned,
  onAssignDriver, onSetStatus, onEdit,
}: {
  job: ReturnType<typeof useJobs>[number];
  stops: Stop[];
  warehouses: ReturnType<typeof useWarehouses>;
  drivers: ReturnType<typeof useDrivers>;
  compliance: Record<string, Compliance>;
  planned: { driverId: string; sequence: number; startAt: string; distKm: number; dailyHoursLeft: number } | null;
  onAssignDriver: (id: string) => void;
  onSetStatus: (s: string) => void;
  onEdit: () => void;
}) {
  const origin = warehouses.find((w) => w.id === stops[0]?.warehouse_id);
  const dest = warehouses.find((w) => w.id === stops[stops.length - 1]?.warehouse_id);
  const isMR = stops.length > 2;
  const driver = drivers.find((d) => d.id === job.assigned_driver_id);

  const effectiveStatus = isJobScheduledFuture(
    {
      ...job,
      stops: stops.map((s, idx) => ({
        seq: idx, kind: s.kind, warehouse_id: s.warehouse_id,
        scheduled_at: s.scheduled_at, arrived_at: s.arrived_at ?? null,
      })),
    },
    Date.now(),
  ) ? "SCHEDULED" : job.status;

  const stopTimes = job.scheduled_at
    ? computeStopSchedule(stops, job.scheduled_at, warehouses)
    : stops.map((s) => s.scheduled_at);

  // Suggested drivers when unassigned
  const ranked = useMemo(() => {
    if (driver || !origin) return [];
    return drivers
      .filter((d) => d.status === "AVAILABLE" || d.status === "ON_SHIFT")
      .filter((d) => d.current_lat != null && d.current_lon != null)
      .map((d) => {
        const distKm = haversineKm(d.current_lat!, d.current_lon!, origin.latitude, origin.longitude);
        return { driver: d, distKm, eta: etaMinutes(distKm) };
      })
      .sort((a, b) => a.distKm - b.distKm);
  }, [driver, drivers, origin]);

  // Auto-validate arrivals as a fallback to GPS geofencing.
  // For each unarrived stop, if planned arrival has passed AND either
  //   - the driver's GPS is stale (>15 min / never reported), OR
  //   - a grace period (20 min) has elapsed since the planned time
  // then assume the driver arrived on time and stamp arrived_at = planned.
  const autoValidatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (stops.length === 0) return;
    if (job.status === "COMPLETED" || job.status === "CANCELLED") return;
    const STALE_MIN = 15;
    const GRACE_MIN = 20;
    const now = Date.now();
    const lastGps = driver?.last_update_time ? new Date(driver.last_update_time).getTime() : 0;
    const gpsStale = !lastGps || (now - lastGps) / 60_000 > STALE_MIN;
    stops.forEach((s, i) => {
      if (!s.id || s.arrived_at) return;
      const planned = stopTimes[i];
      if (!planned) return;
      const plannedMs = new Date(planned).getTime();
      if (plannedMs > now) return;
      const graceElapsed = (now - plannedMs) / 60_000 >= GRACE_MIN;
      if (!gpsStale && !graceElapsed) return;
      if (autoValidatedRef.current.has(s.id)) return;
      autoValidatedRef.current.add(s.id);
      void supabase
        .from("job_stops")
        .update({ arrived_at: planned } as never)
        .eq("id", s.id)
        .is("arrived_at", null)
        .then(({ error }) => {
          if (error && s.id) autoValidatedRef.current.delete(s.id);
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.status, stops, stopTimes, driver?.last_update_time]);


  // Auto-complete: all stops arrived, no significant delays, and not already terminal.
  useEffect(() => {
    if (stops.length === 0) return;
    if (job.status === "COMPLETED" || job.status === "CANCELLED") return;
    const allArrived = stops.every((s) => !!s.arrived_at);
    if (!allArrived) return;
    const anyDelayed = stops.some((s) => {
      const planned = s.scheduled_at;
      if (!planned || !s.arrived_at) return false;
      const delayMin = (new Date(s.arrived_at).getTime() - new Date(planned).getTime()) / 60_000;
      return delayMin > 5;
    });
    if (anyDelayed) return;
    onSetStatus("COMPLETED");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.status, stops]);


  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="font-mono text-xs text-muted-foreground">{job.reference}</div>
            <StatusPill status={effectiveStatus} onChange={onSetStatus} />
            {isMR && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] border border-amber-500/30 text-amber-600 bg-amber-500/5">
                MR · {stops.length} stops
              </span>
            )}
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
            {stops.length === 0 ? (
              <span className="text-muted-foreground">No stops</span>
            ) : (
              stops.map((s, i) => {
                const wh = warehouses.find((w) => w.id === s.warehouse_id);
                return (
                  <span key={i} className="flex items-center gap-2">
                    <span className={s.kind === "PICKUP" ? "text-blue-500" : "text-emerald-600"}>
                      {wh?.code ?? "?"}
                    </span>
                    {i < stops.length - 1 && <ArrowRight className="size-4 text-muted-foreground" />}
                  </span>
                );
              })
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {stops.map((s, i) => {
              const wh = warehouses.find((w) => w.id === s.warehouse_id);
              return `${s.kind === "PICKUP" ? "📦" : "🏁"} ${wh?.name ?? "?"}`;
            }).join(" → ")}
          </p>
        </div>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-2"
        >
          <Pencil className="size-3" /> Edit route
        </button>
      </div>

      {/* Assigned driver */}
      <div className="mt-5 rounded-lg border border-border bg-surface p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Assigned driver</div>
        <DriverPicker
          driverId={job.assigned_driver_id}
          drivers={drivers}
          compliance={compliance}
          onChange={onAssignDriver}
        />
        {!driver && (planned || job.planned_driver_id) && (
          <PlannedChip
            driverName={drivers.find((d) => d.id === (planned?.driverId ?? job.planned_driver_id))?.name ?? "?"}
            sequence={planned?.sequence ?? job.planned_sequence ?? undefined}
            startAt={planned?.startAt ?? job.planned_start_at ?? undefined}
            distanceKm={planned?.distKm}
            dailyHoursLeft={planned?.dailyHoursLeft}
          />
        )}
      </div>

      {/* Suggested drivers */}
      {!driver && ranked.length > 0 && (
        <>
          <div className="mt-6 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
            <Sparkles className="size-3.5 text-accent" /> Suggested drivers (closest first)
          </div>
          <div className="mt-3 rounded-md border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-right">Distance</th>
                  <th className="px-3 py-2 text-right">ETA</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ranked.slice(0, 8).map(({ driver: d, distKm, eta }, i) => {
                  const dc = compliance[d.id];
                  const blocked = !!dc?.blockAssignment;
                  return (
                    <tr key={d.id} className={i === 0 ? "bg-primary/5" : ""}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {i === 0 && <span className="text-[9px] font-mono text-primary border border-primary/40 rounded px-1">BEST</span>}
                          <span>{d.name}</span>
                          {dc && <ComplianceDot c={dc} driverStatus={d.status} />}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{distKm.toFixed(1)} km</td>
                      <td className="px-3 py-2.5 text-right font-mono">{eta} min</td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => onAssignDriver(d.id)}
                          disabled={blocked}
                          title={blocked ? dc?.issues.find((i) => i.level === "breach")?.msg : undefined}
                          className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Assign
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Stops */}
      <div className="mt-6">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Stops · {stops.length}
        </div>
        {stops.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No stops on this route yet.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <div className="col-span-1">#</div>
              <div className="col-span-3">Stop</div>
              <div className="col-span-2">Kind</div>
              <div className="col-span-3">Planned arrival</div>
              <div className="col-span-2">Planned departure</div>
              <div className="col-span-1">Actual</div>
            </div>
            {stops.map((s, idx) => {
              const wh = warehouses.find((w) => w.id === s.warehouse_id);
              const arr = s.scheduled_at ?? stopTimes[idx];
              const dep = arr ? new Date(new Date(arr).getTime() + stopDwellMinutes(s.kind) * 60_000).toISOString() : null;
              const fmt = (iso: string | null | undefined) =>
                iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
              const delayMin = s.arrived_at && arr
                ? Math.round((new Date(s.arrived_at).getTime() - new Date(arr).getTime()) / 60_000)
                : null;
              const isDelayed = delayMin != null && delayMin > 5;
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] border-t border-border items-center">
                  <div className="col-span-1 font-mono text-muted-foreground">{idx + 1}</div>
                  <div className="col-span-3">
                    <div className="font-mono text-xs text-foreground">{wh?.code ?? "?"}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{wh?.name}</div>
                  </div>
                  <div className="col-span-2">
                    <span className={`font-mono text-[10px] uppercase ${s.kind === "PICKUP" ? "text-blue-500" : "text-emerald-600"}`}>
                      {s.kind === "PICKUP" ? "Pickup" : "Drop"}
                    </span>
                  </div>
                  <div className="col-span-3 font-mono text-foreground text-sm">{fmt(arr)}</div>
                  <div className="col-span-2 font-mono text-foreground text-sm">{fmt(dep)}</div>
                  <div className="col-span-1 font-mono">
                    {s.arrived_at ? (
                      <div className="flex flex-col items-start">
                        <span className={isDelayed ? "text-amber-600" : "text-emerald-600"}>
                          {new Date(s.arrived_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {isDelayed && (
                          <span className="text-[9px] text-amber-600">+{delayMin}m late</span>
                        )}
                      </div>
                    ) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Clock className="size-3" />
        {job.scheduled_at
          ? `Scheduled ${new Date(job.scheduled_at).toLocaleString()}`
          : "No scheduled start"}
      </div>
    </div>
  );
}

// ── Shared popover ───────────────────────────────────────────────────────────

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
  drivers: { id: string; name: string; status?: string }[];
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
            <span className="size-7 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0">
              {driver.name[0]?.toUpperCase()}
            </span>
            <span className="text-sm text-foreground font-medium truncate">{driver.name}</span>
            {activeC && <ComplianceDot c={activeC} driverStatus={driver.status} />}
          </>
        ) : (
          <>
            <span className="size-7 rounded-full border border-dashed border-border flex items-center justify-center shrink-0">
              <User className="size-3.5 text-muted-foreground/50" />
            </span>
            <span className="text-sm text-muted-foreground">Unassigned — click to assign</span>
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
                  {dc && (
                    <span className="ml-1 text-[9px] font-mono text-muted-foreground/70">
                      {dc.weekly.toFixed(0)}/56 · {dc.dailyHeadroom.toFixed(1)}h left
                    </span>
                  )}
                </span>
                {dc && <ComplianceDot c={dc} driverStatus={d.status} />}
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

// ── Create/Edit dialog ───────────────────────────────────────────────────────

function RouteDialog({
  mode, jobId, initial, onClose, warehouses,
}: {
  mode: "create" | "edit";
  jobId?: string;
  initial?: { scheduled_at: string | null; stops: Stop[] };
  onClose: () => void;
  warehouses: ReturnType<typeof useWarehouses>;
}) {
  const [stops, setStops] = useState<Stop[]>(
    initial?.stops?.length
      ? initial.stops.map((s) => ({ ...s, scheduled_at: s.scheduled_at }))
      : [
          { kind: "PICKUP", warehouse_id: "", scheduled_at: new Date().toISOString() },
          { kind: "DROP", warehouse_id: "", scheduled_at: null },
        ],
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const startIso = stops[0]?.scheduled_at ?? initial?.scheduled_at ?? new Date().toISOString();
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

    const jobStartIso = startIso;
    const autoTimes = computeStopSchedule(stops, jobStartIso, warehouses);

    const tenant_id = await getTenantId();
    const jobPayload = {
      scheduled_at: jobStartIso,
      origin_warehouse_id: stops[0].warehouse_id,
      destination_warehouse_id: stops[stops.length - 1].warehouse_id,
      tenant_id,
    };

    let targetJobId = jobId;
    if (mode === "create") {
      const { data, error } = await supabase.from("jobs").insert(jobPayload as never).select("id").single();
      if (error) { setSaving(false); console.error("[jobs.insert]", error); return toast.error(`Job create failed: ${error.message}`); }
      targetJobId = (data as { id: string }).id;
    } else {
      const { error } = await supabase.from("jobs").update(jobPayload).eq("id", targetJobId!);
      if (error) { setSaving(false); console.error("[jobs.update]", error); return toast.error(`Job update failed: ${error.message}`); }
    }

    const { error: delErr } = await supabase.from("job_stops").delete().eq("job_id", targetJobId!);
    if (delErr) { setSaving(false); console.error("[stops.delete]", delErr); return toast.error(`Clear stops failed: ${delErr.message}`); }

    const rows = stops.map((s, i) => ({
      job_id: targetJobId!,
      seq: i,
      kind: s.kind as never,
      warehouse_id: s.warehouse_id,
      scheduled_at: i === 0 ? (s.scheduled_at ?? autoTimes[i] ?? null) : (autoTimes[i] ?? null),
    }));
    const { error: stopErr } = await supabase.from("job_stops").insert(rows as never);
    setSaving(false);
    if (stopErr) { console.error("[stops.insert]", stopErr, rows); return toast.error(`Stops insert failed: ${stopErr.message}`); }

    const firstArrival = rows.map((r) => r.scheduled_at).find((s) => !!s) as string | undefined;
    const firstDate = firstArrival ? firstArrival.slice(0, 10) : null;
    const tomorrow = (() => { const t = new Date(); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); })();
    if (firstDate === tomorrow) {
      toast.success("Route scheduled for tomorrow — click Plan Tomorrow to assign a driver");
    } else {
      toast.success(mode === "create" ? "Route created" : "Route updated");
    }
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
                      {i === 0 ? (
                        <input
                          type="datetime-local"
                          required
                          value={s.scheduled_at ? toLocalInput(s.scheduled_at) : ""}
                          onChange={(e) => update(i, { scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                          className="bg-surface border border-border rounded px-2 py-1 text-xs"
                          title="Pickup time — subsequent stops are auto-calculated from this"
                        />
                      ) : (
                        <>
                          <span className="text-xs font-mono text-muted-foreground italic px-2 py-1">
                            {auto ? new Date(auto).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground/70 mt-0.5">auto</span>
                        </>
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

function PlannedChip({
  driverName, sequence, startAt, distanceKm, dailyHoursLeft,
}: {
  driverName: string;
  sequence?: number;
  startAt?: string;
  distanceKm?: number;
  dailyHoursLeft?: number;
}) {
  const when = startAt
    ? new Date(startAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <div
      title="Planned follow-on assignment — not confirmed yet"
      className="mt-2 inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
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

function ComplianceDot({ c, driverStatus }: { c: Compliance; driverStatus?: string }) {
  const activeStatus = driverStatus && driverStatus !== "OFF_SHIFT";
  const offShift = !c.onShift && !activeStatus;
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

// ── Dispatch stat card ────────────────────────────────────────────────────────

function DispatchStat({
  label, value, color, active, onClick,
}: {
  label: string; value: number; color: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Filter by ${label}`}
      style={{
        minWidth: "76px",
        padding: "0.45rem 0.75rem",
        borderRadius: "0.5rem",
        borderLeft: `2px solid ${color}`,
        borderTop:    `1px solid ${active ? "oklch(0.32 0.020 245)" : "oklch(0.24 0.018 245)"}`,
        borderRight:  `1px solid ${active ? "oklch(0.32 0.020 245)" : "oklch(0.24 0.018 245)"}`,
        borderBottom: `1px solid ${active ? "oklch(0.32 0.020 245)" : "oklch(0.24 0.018 245)"}`,
        background: active ? "oklch(0.20 0.020 245)" : "oklch(0.17 0.018 245)",
        textAlign: "left" as const,
        cursor: "pointer",
        transition: "all 150ms ease",
        boxShadow: active ? `0 0 0 1px ${color}, 0 2px 8px oklch(0 0 0 / 0.25)` : "none",
        flexShrink: 0,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "oklch(0.19 0.018 245)"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "oklch(0.17 0.018 245)"; }}
    >
      <div style={{
        fontSize: "9px", fontFamily: "var(--font-mono)", textTransform: "uppercase" as const,
        letterSpacing: "0.08em", color: "oklch(0.55 0.014 245)", lineHeight: 1, whiteSpace: "nowrap" as const,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: "1.35rem", fontFamily: "var(--font-mono)", fontWeight: 700,
        marginTop: "0.2rem", lineHeight: 1, fontVariantNumeric: "tabular-nums", color,
      }}>
        {value}
      </div>
    </button>
  );
}
