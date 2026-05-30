import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronDown, MapPin, Plus, Search } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { z } from "zod";

import { useCompliance, useDrivers, useJobs, useWarehouses, applyJobPatch } from "@/lib/hooks";
import { computePlan, type PlannedAssign } from "@/lib/planner";
import type { DriverShift, DriverAvailabilityOverride } from "@/lib/types";
import { planJobs } from "@/lib/plan-jobs.functions";
import { fetchShiftsByDriver } from "@/lib/driver-shifts";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { cn } from "@/lib/utils";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import {
  ACTIVE_JOB_STATUSES,
  JOB_STATUSES,
  STATUS_BOX_KEYS,
  STATUS_CONFIG,
  endOfDay,
  fmtDateShort,
  jobDate,
  sameDay,
  startOfDay,
} from "@/lib/dispatch/status";
import type { JobStatus, Job } from "@/lib/types";
import { useLookups } from "@/lib/dispatch/lookups";
import { useJobStops } from "@/lib/dispatch/use-job-stops";
import { DispatchStat, ImportCsvButton, ToolbarButton } from "@/components/dispatch/toolbar";
import { AuditPlanButton } from "@/components/dispatch/audit-plan-button";
import { JobQueue } from "@/components/dispatch/queue";
import { JobDetailPanel } from "@/components/dispatch/detail-panel";

// Lazy-loaded — dialog code only ships when the user opens create/edit.
const RouteDialog = lazy(() => import("@/components/dispatch/route-dialog"));

// Search params schema — `job` is an optional job reference string used for
// deep-linking from the Alerts page (e.g. /dispatch?job=114KBDG83).
const dispatchSearchSchema = z.object({
  job: z.string().optional(),
});

export const Route = createFileRoute("/_app/dispatch")({
  validateSearch: dispatchSearchSchema,
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

  // Deep-link: if the URL contains ?job=REFERENCE, pre-select that job.
  const { job: jobRefParam } = useSearch({ from: "/_app/dispatch" });

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
    } catch {
      /* noop */
    }
    // Default: show PENDING, ASSIGNED, IN_PROGRESS, ARRIVED_PICKUP, EN_ROUTE_DELIVERY
    // Hide: COMPLETED, CANCELLED
    return new Set<JobStatus>(["COMPLETED", "CANCELLED"]);
  });
  useEffect(() => {
    try {
      localStorage.setItem("dispatch.hiddenStatuses", JSON.stringify(Array.from(hiddenStatuses)));
    } catch {
      /* noop */
    }
  }, [hiddenStatuses]);

  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!statusMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node))
        setStatusMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [statusMenuOpen]);

  function toggleStatus(s: JobStatus) {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
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
    } catch {
      /* noop */
    }
    return { from: today, to: today };
  });
  useEffect(() => {
    try {
      if (!dateRange) localStorage.setItem("dispatch.dateRange", JSON.stringify({ mode: "all" }));
      else if (dateRange.from) {
        localStorage.setItem(
          "dispatch.dateRange",
          JSON.stringify({
            from: dateRange.from.toISOString(),
            to: (dateRange.to ?? dateRange.from).toISOString(),
          }),
        );
      }
    } catch {
      /* noop */
    }
  }, [dateRange]);

  const [statusFilter, setStatusFilter] = useState<JobStatus | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("dispatch.statusFilter");
      if (raw) {
        const parsed = JSON.parse(raw) as JobStatus | null;
        if (parsed && (JOB_STATUSES as readonly string[]).includes(parsed)) return parsed;
      }
    } catch {
      /* noop */
    }
    return null;
  });
  useEffect(() => {
    try {
      if (statusFilter) localStorage.setItem("dispatch.statusFilter", JSON.stringify(statusFilter));
      else localStorage.removeItem("dispatch.statusFilter");
    } catch {
      /* noop */
    }
  }, [statusFilter]);

  // ── Deep-link: navigate to a specific job by reference ────────────────────
  // When the URL contains ?job=REFERENCE (e.g. from the Alerts page), find
  // the matching job, clear any status/date filters that would hide it, and
  // select it. This runs once when the param and jobs are both available.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (!jobRefParam || deepLinkApplied.current || jobs.length === 0) return;
    const target = jobs.find((j) => j.reference === jobRefParam);
    if (!target) return;
    deepLinkApplied.current = true;

    // Clear status filter and show all statuses so the job is visible
    setStatusFilter(null);
    setHiddenStatuses(new Set<JobStatus>(["COMPLETED", "CANCELLED"]));
    // Clear date range to "All dates" so the job is not filtered out
    setDateRange(undefined);
    // Set search to the job reference (VRID) for filtering
    setSearch(jobRefParam);
    // Select the job
    setSelectedJobId(target.id);
  }, [jobRefParam, jobs]);

  // ── Plan (memoized using compliance ref to avoid minute-tick churn) ────────
  const complianceRef = useRef(compliance);
  useEffect(() => {
    complianceRef.current = compliance;
  }, [compliance]);

  const [driverShifts, setDriverShifts] = useState<Record<string, DriverShift>>({});
  const [shiftOverrides, setShiftOverrides] = useState<DriverAvailabilityOverride[]>([]);

  useEffect(() => {
    if (drivers.length === 0) return;
    const driverIds = drivers.map((d) => d.id);
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = (() => {
      const t = new Date();
      t.setUTCDate(t.getUTCDate() + 1);
      return t.toISOString().slice(0, 10);
    })();
    Promise.all([
      fetchShiftsByDriver(supabase, driverIds),
      supabase
        .from("driver_availability_overrides")
        .select("*")
        .in("driver_id", driverIds)
        .gte("date", today)
        .lte("date", tomorrow),
    ]).then(([shiftsByDriver, { data: overrides }]) => {
      setDriverShifts(shiftsByDriver);
      if (overrides) setShiftOverrides(overrides as DriverAvailabilityOverride[]);
    });
  }, [drivers]);

  const plan = useMemo(
    () =>
      computePlan(
        jobs,
        stopsMap,
        drivers,
        warehouses,
        complianceRef.current,
        Date.now(),
        driverShifts,
        shiftOverrides,
      ),
    [jobs, stopsMap, drivers, warehouses, driverShifts, shiftOverrides],
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
      if (
        typeof window !== "undefined" &&
        !window.confirm("Remove driver from this active job? It will go back to Pending.")
      )
        return;
    }

    // Assigning a driver puts the job in ASSIGNED. IN_PROGRESS is owned by
    // the driver app (first leg start) — dispatch must never set it here.
    const base = driverId
      ? { assigned_driver_id: driverId, status: "ASSIGNED" as never }
      : {
          assigned_driver_id: null,
          status: "PENDING" as never,
          planned_driver_id: null,
          planned_sequence: null,
          planned_start_at: null,
        };
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

    const { error } = await supabase
      .from("jobs")
      .update(payload as never)
      .eq("id", jobId);
    if (error) {
      if (prev) applyJobPatch(jobId, prev);
      toast.error(error.message);
      return;
    }

    if (driverId) {
      await supabase
        .from("drivers")
        .update({ status: "ON_ROUTE" } as never)
        .eq("id", driverId);
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

  const runPlanJobs = useServerFn(planJobs);
  const [planning, setPlanning] = useState(false);
  async function onPlan() {
    if (planning) return;
    setPlanning(true);
    try {
      const r = await runPlanJobs();
      const msg = `Planned ${r.assigned}/${r.totalJobs} routes · ${r.driversPlanned} driver${r.driversPlanned === 1 ? "" : "s"}`;
      if (r.unassignable.length) toast.warning(`${msg} · ${r.unassignable.length} unassignable`);
      else toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlanning(false);
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
    const { error } = await supabase
      .from("jobs")
      .update({ status: status as never })
      .eq("id", jobId);
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
      PENDING: 0,
      ASSIGNED: 0,
      IN_PROGRESS: 0,
      ARRIVED_PICKUP: 0,
      EN_ROUTE_DELIVERY: 0,
      COMPLETED: 0,
      CANCELLED: 0,
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
        else if ((STATUS_CONFIG[j.status as JobStatus]?.label ?? "").toLowerCase().includes(q))
          match = true;
        else {
          const stops = stopsMap[j.id] ?? [];
          for (const s of stops) {
            const w = lookups.warehousesById.get(s.warehouse_id);
            if (w && `${w.code} ${w.name}`.toLowerCase().includes(q)) {
              match = true;
              break;
            }
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

    // Consolidate counts for "In Progress"
    counts.IN_PROGRESS += counts.ARRIVED_PICKUP + counts.EN_ROUTE_DELIVERY;

    return { jobsInRange: inRange, statusCounts: counts };
  }, [jobs, stopsMap, search, dateRange, lookups.warehousesById, lookups.driversById]);

  const filteredJobs = useMemo(() => {
    const filtered = jobsInRange.filter((j) => {
      if (statusFilter) {
        if (statusFilter === "IN_PROGRESS") {
          return (
            j.status === "IN_PROGRESS" ||
            j.status === "ARRIVED_PICKUP" ||
            j.status === "EN_ROUTE_DELIVERY"
          );
        }
        return j.status === statusFilter;
      }
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
  // But don't override a deep-link selection that was just applied.
  useEffect(() => {
    if (selectedJobId && filteredJobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(filteredJobs[0]?.id ?? null);
  }, [filteredJobs, selectedJobId]);

  const selectedJob = selectedJobId
    ? (filteredJobs.find((j) => j.id === selectedJobId) ?? null)
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


  const PlanningOverlay =
    planning && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-[oklch(0.12_0.018_245/0.92)] backdrop-blur-md">
            <style>{`@keyframes plan-slide{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}`}</style>
            <div className="size-9 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <div className="text-center">
              <p className="text-base font-semibold text-[oklch(0.93_0.006_240)] mb-1">
                Planning Routes
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

  const editingJob = editJobId ? (lookups.jobsById.get(editJobId) ?? null) : null;

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
            onClick={onPlan}
            disabled={planning}
            title="Auto-assign drivers to all pending routes across every date"
            primary
          >
            {planning ? "Planning…" : "Plan"}
          </ToolbarButton>
          <AuditPlanButton />
          <ImportCsvButton />
          <ToolbarButton
            onClick={() => setCreateOpen(true)}
            primary
            icon={<Plus className="size-3.5" />}
          >
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
              <button
                onClick={() => {
                  const t = startOfDay(new Date());
                  setDateRange({ from: t, to: t });
                }}
                className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground"
              >
                Today
              </button>
              <button
                onClick={() => {
                  const y = startOfDay(new Date(Date.now() - 86400000));
                  setDateRange({ from: y, to: y });
                }}
                className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground"
              >
                Yesterday
              </button>
              <button
                onClick={() => {
                  const tm = startOfDay(new Date(Date.now() + 86400000));
                  setDateRange({ from: tm, to: tm });
                }}
                className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground"
              >
                Tomorrow
              </button>
              <button
                onClick={() => {
                  const to = startOfDay(new Date());
                  const from = startOfDay(new Date(Date.now() - 6 * 86400000));
                  setDateRange({ from, to });
                }}
                className="rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground"
              >
                7d
              </button>
              <button
                onClick={() => setDateRange(undefined)}
                className="ml-auto rounded px-2 py-1 hover:bg-surface-2 hover:text-foreground"
              >
                All
              </button>
            </div>
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={1}
              modifiers={{ hasJobs: (d) => hasJobsOn(d) }}
              modifiersClassNames={{
                hasJobs: "font-semibold underline underline-offset-4 decoration-primary/70",
              }}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        <div className="relative flex-1 max-w-md">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by reference, driver, status…"
            className="w-full h-9 pl-9 pr-8 rounded-md border border-border bg-surface text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>

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
                  <button
                    onClick={() => setHiddenStatuses(new Set())}
                    className="hover:text-foreground"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setHiddenStatuses(new Set(JOB_STATUSES))}
                    className="hover:text-foreground"
                  >
                    None
                  </button>
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
              onSetStatus={(s, opts) => {
                void setStatus(selectedJob.id, s, opts);
              }}
              onEdit={() => setEditJobId(selectedJob.id)}
            />
          )}
        </div>
      </div>

      {(createOpen || editingJob) && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </div>
  );
}
