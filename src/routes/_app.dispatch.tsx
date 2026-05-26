import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronDown, MapPin, Plus, Sparkles } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";

import { useCompliance, useDrivers, useJobs, useWarehouses, applyJobPatch } from "@/lib/hooks";
import { computePlan, AUTO_ASSIGN_RADIUS_KM, type PlannedAssign } from "@/lib/planner";
import { planTomorrow } from "@/lib/tomorrow.functions";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { cn } from "@/lib/utils";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import {
  ACTIVE_JOB_STATUSES, JOB_STATUSES, STATUS_BOX_KEYS, STATUS_CONFIG,
  endOfDay, fmtDateShort, jobDate, sameDay, startOfDay,
} from "@/lib/dispatch/status";
import type { JobStatus, Job } from "@/lib/types";
import { useLookups } from "@/lib/dispatch/lookups";
import { useJobStops } from "@/lib/dispatch/use-job-stops";
import { useAutoPlanner } from "@/lib/dispatch/use-auto-planner";

import { DispatchStat, ImportCsvButton, ToolbarButton } from "@/components/dispatch/toolbar";
import { JobQueue } from "@/components/dispatch/queue";
import { JobDetailPanel } from "@/components/dispatch/detail-panel";

// Lazy-loaded — dialog code only ships when the user opens create/edit.
const RouteDialog = lazy(() => import("@/components/dispatch/route-dialog"));

void AUTO_ASSIGN_RADIUS_KM;

export const Route = createFileRoute("/_app/dispatch")({
  component: DispatchPage,
  head: () => ({ meta: [{ title: "Dispatch — Planning System" }] }),
});

function DispatchPage() {
  const jobs = useJobs();
  const warehouses = useWarehouses();
  const drivers = useDrivers();
  const stopsMap = useJobStops();
  const compliance = useCompliance();

  const lookups = useLookups(jobs, drivers, warehouses);

  // ── Persisted UI state ─────────────────────────────────────────────────────
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

  // ── Plan (memoized using compliance ref to avoid minute-tick churn) ────────
  const complianceRef = useRef(compliance);
  useEffect(() => { complianceRef.current = compliance; }, [compliance]);

  // Compute the plan only when *structural* inputs change. Compliance ticks
  // every minute; we read it via ref so the plan doesn't recompute (and the
  // detail panel doesn't reflow) just because a clock advanced.
  const plan = useMemo(
    () => computePlan(jobs, stopsMap, drivers, warehouses, complianceRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, stopsMap, drivers, warehouses],
  );

  const plannedByJob = useMemo(
    () => new Map<string, PlannedAssign>(plan.planned.map((item) => [item.jobId, item])),
    [plan],
  );

  // (Removed) Client-side "normalize" effect that forced ASSIGNED jobs back
  // to PENDING. The DB is the source of truth for status; the only legitimate
  // PENDING→ASSIGNED transition is via the Plan button or a manual assign,
  // and ASSIGNED→IN_PROGRESS comes from the driver app starting a leg.

  // ── Mutations ──────────────────────────────────────────────────────────────

  async function assignDriver(jobId: string, driverId: string, opts?: { manual?: boolean }) {
    if (driverId) {
      const c = compliance[driverId];
      if (c?.blockAssignment) {
        const reason = c.issues.find((i) => i.level === "breach")?.msg ?? "compliance breach";
        toast.error(`Cannot assign: ${reason}`);
        return;
      }
    }
    const job = lookups.jobsById.get(jobId);
    const wasActive = job ? ACTIVE_JOB_STATUSES.has(job.status) : false;
    if (!driverId && opts?.manual && wasActive) {
      if (typeof window !== "undefined" && !window.confirm("Remove driver from this active job? It will go back to Pending.")) return;
    }

    // Assigning a driver puts the job in ASSIGNED. IN_PROGRESS is owned by
    // the driver app (first leg start) — dispatch must never set it here.
    const base = driverId
      ? { assigned_driver_id: driverId, status: "ASSIGNED" as never }
      : { assigned_driver_id: null, status: "PENDING" as never, planned_driver_id: null, planned_sequence: null, planned_start_at: null };
    const payload = opts?.manual ? { ...base, manual_override: true } : base;

    // Optimistic update with rollback on error.
    const prev: Partial<Job> | null = job
      ? {
          assigned_driver_id: job.assigned_driver_id,
          status: job.status,
          planned_driver_id: job.planned_driver_id,
          planned_sequence: job.planned_sequence,
          planned_start_at: job.planned_start_at,
        }
      : null;
    applyJobPatch(jobId, payload as Partial<Job>);

    const { error } = await supabase.from("jobs").update(payload as never).eq("id", jobId);
    if (error) {
      if (prev) applyJobPatch(jobId, prev);
      toast.error(error.message);
      return;
    }

    if (driverId) {
      await supabase.from("drivers").update({ status: "ON_ROUTE" } as never).eq("id", driverId);
      try {
        const tenantId = await getTenantId();
        await supabase.from("driver_events").insert({
          driver_id: driverId,
          type: "JOB_ASSIGNED",
          payload: { job_id: jobId, manual: opts?.manual ?? false },
          tenant_id: tenantId,
        } as never);
      } catch (e) {
        console.warn("[dispatch] failed to log JOB_ASSIGNED", e);
      }
    } else if (job?.assigned_driver_id) {
      await supabase
        .from("drivers")
        .update({ status: "AVAILABLE" } as never)
        .eq("id", job.assigned_driver_id)
        .eq("status", "ON_ROUTE" as never);
    }
  }

  // Manual planner — wired to the "Plan now" button. Does NOT self-fire.
  const { run: runAutoPlan } = useAutoPlanner({
    plan, jobs, stopsMap, warehouses,
    assignDriver: (id, did) => assignDriver(id, did),
  });
  const [planningNow, setPlanningNow] = useState(false);
  async function onPlanNow() {
    if (planningNow) return;
    setPlanningNow(true);
    try {
      const r = await runAutoPlan();
      const total = r.assigned + r.planned;
      if (total === 0) toast.info("No assignable jobs right now");
      else toast.success(`Planned ${r.assigned} immediate · ${r.planned} chained`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlanningNow(false);
    }
  }

  async function setStatus(jobId: string, status: string, opts?: { silent?: boolean }) {
    const job = lookups.jobsById.get(jobId);
    if (!job) return;
    if (job.status === status) return;
    const requiresDriver = ACTIVE_JOB_STATUSES.has(status as JobStatus);
    if (requiresDriver && !job.assigned_driver_id) {
      toast.error("Assign a driver before setting this route in progress");
      return;
    }
    const prevStatus = job.status;
    applyJobPatch(jobId, { status: status as JobStatus });
    const { error } = await supabase.from("jobs").update({ status: status as never }).eq("id", jobId);
    if (error) {
      applyJobPatch(jobId, { status: prevStatus });
      toast.error(error.message);
      return;
    }
    if (!opts?.silent) {
      toast.success(`Status → ${STATUS_CONFIG[status as JobStatus]?.label ?? status}`);
    }
  }

  // ── Filter pipeline ────────────────────────────────────────────────────────

  // Single pass that produces both `jobsInRange` and `statusCounts`,
  // avoiding two separate iterations of the same array.
  const { jobsInRange, statusCounts } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateRange?.from ? startOfDay(dateRange.from).getTime() : null;
    const to = dateRange ? endOfDay(dateRange.to ?? dateRange.from ?? new Date()).getTime() : null;
    const counts: Record<JobStatus, number> = {
      PENDING: 0, ASSIGNED: 0, IN_PROGRESS: 0, ARRIVED_PICKUP: 0,
      EN_ROUTE_DELIVERY: 0, COMPLETED: 0, CANCELLED: 0,
    };
    const inRange: Job[] = [];

    for (const j of jobs) {
      if (from !== null && to !== null) {
        const t = jobDate(j, stopsMap[j.id] ?? []).getTime();
        if (t < from || t > to) continue;
      }
      if (q) {
        let match = false;
        if (j.reference.toLowerCase().includes(q)) match = true;
        else if (j.status.toLowerCase().replace(/_/g, " ").includes(q)) match = true;
        else if ((STATUS_CONFIG[j.status as JobStatus]?.label ?? "").toLowerCase().includes(q)) match = true;
        else {
          const stops = stopsMap[j.id] ?? [];
          for (const s of stops) {
            const w = lookups.warehousesById.get(s.warehouse_id);
            if (w && (`${w.code} ${w.name}`).toLowerCase().includes(q)) { match = true; break; }
          }
          if (!match && j.assigned_driver_id) {
            const driver = lookups.driversById.get(j.assigned_driver_id);
            if (driver?.name.toLowerCase().includes(q)) match = true;
          }
        }
        if (!match) continue;
      }
      counts[j.status as JobStatus] = (counts[j.status as JobStatus] ?? 0) + 1;
      inRange.push(j);
    }

    return { jobsInRange: inRange, statusCounts: counts };
  }, [jobs, stopsMap, search, dateRange, lookups.warehousesById, lookups.driversById]);

  const filteredJobs = useMemo(() => {
    const filtered = jobsInRange.filter((j) => {
      if (statusFilter) return j.status === statusFilter;
      return !hiddenStatuses.has(j.status as JobStatus);
    });
    filtered.sort((a, b) => {
      const ta = jobDate(a, stopsMap[a.id] ?? []).getTime();
      const tb = jobDate(b, stopsMap[b.id] ?? []).getTime();
      return ta - tb;
    });
    return filtered;
  }, [jobsInRange, hiddenStatuses, statusFilter, stopsMap]);

  // Keep selection valid; default to first filtered job.
  useEffect(() => {
    if (selectedJobId && filteredJobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(filteredJobs[0]?.id ?? null);
  }, [filteredJobs, selectedJobId]);

  const selectedJob = selectedJobId
    ? filteredJobs.find((j) => j.id === selectedJobId) ?? null
    : null;

  // ── Date label & calendar helpers ──────────────────────────────────────────

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

  const hasJobsOn = useMemo(
    () => (d: Date) => jobDays.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`),
    [jobDays],
  );

  // ── Tomorrow stats ─────────────────────────────────────────────────────────

  const tomorrowStats = useMemo(() => {
    const tm = startOfDay(new Date(Date.now() + 86400000));
    const tmJobs = jobs.filter((j) => sameDay(jobDate(j, stopsMap[j.id] ?? []), tm));
    const assigned = tmJobs.filter((j) => !!j.assigned_driver_id);
    const plannedOnly = tmJobs.filter((j) => !j.assigned_driver_id && !!j.planned_driver_id);
    const availableDrivers = drivers.filter(
      (d) => (d as { available_tomorrow?: boolean }).available_tomorrow === true,
    );
    const isTomorrowView =
      !!dateRange?.from && sameDay(dateRange.from, tm) && sameDay(dateRange.to ?? dateRange.from, tm);
    return {
      total: tmJobs.length,
      assigned: assigned.length,
      plannedOnly: plannedOnly.length,
      availableDrivers,
      isTomorrowView,
    };
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

  const PlanningOverlay = planningTomorrow && typeof document !== "undefined"
    ? createPortal(
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-[oklch(0.12_0.018_245/0.92)] backdrop-blur-md">
          <style>{`@keyframes plan-slide{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}`}</style>
          <Sparkles className="size-9 text-[oklch(0.75_0.18_245)] animate-pulse" />
          <div className="text-center">
            <p className="text-base font-semibold text-[oklch(0.93_0.006_240)] mb-1">
              Planning Tomorrow's Routes
            </p>
            <p className="text-xs text-[oklch(0.55_0.014_245)] font-mono">
              Assigning drivers — please wait, do not navigate away
            </p>
          </div>
          <div className="w-72 h-1 rounded-full bg-[oklch(0.24_0.018_245)] overflow-hidden relative">
            <div
              className="absolute h-full w-[45%] rounded-full bg-[oklch(0.75_0.18_245)]"
              style={{ animation: "plan-slide 1.4s cubic-bezier(0.4,0,0.6,1) infinite" }}
            />
          </div>
        </div>,
        document.body,
      )
    : null;

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

  const editingJob = editJobId ? lookups.jobsById.get(editJobId) ?? null : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {PlanningOverlay}

      <header className="px-5 py-3 border-b border-border grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Dispatch</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filteredJobs.length} shown of {jobs.length} total
          </p>
        </div>
        <div className="flex items-center gap-2 justify-self-center">
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
            onClick={onPlanNow}
            disabled={planningNow}
            title="Assign the closest available driver to each pending job"
            icon={<Sparkles className="size-3.5" />}
          >
            {planningNow ? "Planning…" : "Plan now"}
          </ToolbarButton>
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
      <div className="px-5 py-2.5 flex items-center gap-2 border-b border-[oklch(0.20_0.016_245)] bg-[oklch(0.15_0.018_245/0.6)]">
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all",
                "bg-[oklch(0.17_0.018_245)] border-[oklch(0.26_0.018_245)] hover:bg-[oklch(0.20_0.020_245)]",
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
          placeholder="Search reference, driver, status…"
          className="field-input flex-1"
        />

        <div ref={statusMenuRef} className="relative">
          <button
            onClick={() => setStatusMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-foreground transition-all bg-[oklch(0.17_0.018_245)] border-[oklch(0.26_0.018_245)] hover:bg-[oklch(0.20_0.020_245)]"
          >
            Statuses
            <span className="font-mono text-[10px] text-muted-foreground">
              {JOB_STATUSES.length - hiddenStatuses.size}/{JOB_STATUSES.length}
            </span>
            <ChevronDown className="size-3" />
          </button>
          {statusMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-xl overflow-hidden bg-[oklch(0.19_0.020_245)] border border-[oklch(0.28_0.020_245)] shadow-[0_8px_24px_oklch(0_0_0/0.45)]">
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
                      {statusCounts[s] ?? 0}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {!isDefaultFilters && (
          <button
            onClick={() => {
              const t = startOfDay(new Date());
              setSearch("");
              setStatusFilter(null);
              setHiddenStatuses(new Set<JobStatus>(["COMPLETED", "CANCELLED"]));
              setDateRange({ from: t, to: t });
            }}
            className="rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground transition-all bg-[oklch(0.17_0.018_245)] border-[oklch(0.26_0.018_245)] hover:text-[oklch(0.95_0.006_240)]"
          >
            Reset
          </button>
        )}
      </div>

      {tomorrowStats.isTomorrowView && tomorrowStats.total > 0 && (
        <div
          className="mx-5 mt-3 rounded-xl border px-4 py-2.5 flex items-center justify-between text-xs fade-up"
          style={{
            background: tomorrowStats.assigned === tomorrowStats.total
              ? "oklch(0.73 0.17 150 / 0.06)" : "oklch(0.80 0.18 72 / 0.06)",
            borderColor: tomorrowStats.assigned === tomorrowStats.total
              ? "oklch(0.73 0.17 150 / 0.25)" : "oklch(0.80 0.18 72 / 0.25)",
          }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Tomorrow coverage
            </span>
            <span className="font-mono">
              <span style={{ color: tomorrowStats.assigned === tomorrowStats.total ? "oklch(0.78 0.14 150)" : "oklch(0.80 0.16 72)" }}>
                {tomorrowStats.assigned}
              </span>
              <span className="text-muted-foreground"> / {tomorrowStats.total} confirmed</span>
            </span>
            {tomorrowStats.plannedOnly > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="font-mono" title="Driver planned but job still PENDING — run planner writes planned_driver_id; jobs become ASSIGNED once driver confirms">
                  <span style={{ color: "oklch(0.75 0.18 245)" }}>{tomorrowStats.plannedOnly}</span>
                  <span className="text-muted-foreground"> planned (pending confirm)</span>
                </span>
              </>
            )}
            <span className="text-muted-foreground/40">·</span>
            <span className="font-mono text-muted-foreground">
              {tomorrowStats.availableDrivers.length} driver{tomorrowStats.availableDrivers.length === 1 ? "" : "s"} available
            </span>
          </div>
          <button
            onClick={onPlanTomorrow}
            disabled={planningTomorrow}
            className="text-xs font-medium transition-colors disabled:opacity-50 text-[oklch(0.75_0.18_245)] hover:text-[oklch(0.85_0.14_245)]"
          >
            {planningTomorrow ? "Planning…" : "Re-run planner →"}
          </button>
        </div>
      )}

      {/* Two-column body */}
      <div className="flex-1 min-h-0 grid grid-cols-[360px_1fr]">
        <JobQueue
          jobs={filteredJobs}
          totalJobs={jobs.length}
          selectedJobId={selectedJobId}
          stopsMap={stopsMap}
          lookups={lookups}
          plannedByJob={plannedByJob}
          onSelect={setSelectedJobId}
        />

        <div className="overflow-y-auto bg-[oklch(0.14_0.016_245)]">
          {!selectedJob ? (
            <div className="h-full grid place-items-center">
              <div className="text-center">
                <div className="size-12 rounded-full grid place-items-center mx-auto mb-3 bg-[oklch(0.22_0.018_245)]">
                  <MapPin className="size-5 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground">Select a route from the queue</p>
              </div>
            </div>
          ) : (
            <JobDetailPanel
              key={selectedJob.id}
              job={selectedJob}
              stops={stopsMap[selectedJob.id] ?? []}
              warehouses={warehouses}
              drivers={drivers}
              compliance={compliance}
              lookups={lookups}
              planned={plannedByJob.get(selectedJob.id) ?? null}
              onAssignDriver={(id) => assignDriver(selectedJob.id, id, { manual: true })}
              onSetStatus={(s, opts) => { void setStatus(selectedJob.id, s, opts); }}
              onEdit={() => setEditJobId(selectedJob.id)}
            />
          )}
        </div>
      </div>

      {(createOpen || editingJob) && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </div>
  );
}
