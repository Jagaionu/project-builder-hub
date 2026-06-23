import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BrainCircuit,
  Calendar as CalendarIcon,
  ChevronDown,
  MapPin,
  RotateCcw,
  Search,
  Truck,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { z } from "zod";

import {
  useCompliance,
  useDrivers,
  useJobs,
  useWarehouses,
  applyJobPatch,
  reloadJobs,
} from "@/lib/hooks";
import type { PlannedAssign } from "@/lib/planner";
import type { DriverShift, DriverAvailabilityOverride } from "@/lib/types";
import { planJobs } from "@/lib/plan-jobs.functions";
import { refreshDriverDay } from "@/lib/shift-ledger.functions";
import { fetchShiftsByDriver } from "@/lib/driver-shifts";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { logActivity } from "@/lib/activity-log";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme-context";

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
import { useJobStops, reloadJobStops } from "@/lib/dispatch/use-job-stops";
import { DispatchStat, ImportCsvButton, ToolbarButton } from "@/components/dispatch/toolbar";
import { AuditPlanButton } from "@/components/dispatch/audit-plan-button";
import { ImportBatchesButton } from "@/components/dispatch/import-batches";
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

  const { accentColor } = useTheme();

  // Deep-link: if the URL contains ?job=REFERENCE, pre-select that job.
  const { job: jobRefParam } = useSearch({ from: "/_app/dispatch" });

  // ── Persisted UI state ─────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tourDriverId, setTourDriverId] = useState<string | null>(null);

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

  // ── Driver shift schedules (loaded async, kept for detail-panel display) ───
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

  // Planned-by-job map derived from jobs table (populated by server-side planJobs).
  // Replaces client-side computePlan — single source of truth: the DB.
  const plannedByJob = useMemo(() => {
    const m = new Map<
      string,
      {
        jobId: string;
        driverId: string;
        sequence: number;
        startAt: string;
        distKm: number;
        dailyHoursLeft: number;
        weeklyHoursLeft: number;
      }
    >();
    for (const j of jobs) {
      if (j.planned_driver_id && j.planned_sequence != null) {
        m.set(j.id, {
          jobId: j.id,
          driverId: j.planned_driver_id,
          sequence: j.planned_sequence,
          startAt: j.planned_start_at ?? "",
          distKm: 0,
          dailyHoursLeft: 0,
          weeklyHoursLeft: 0,
        });
      }
    }
    return m;
  }, [jobs]);

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
      void logActivity("job.assign", {
        entityType: "job",
        entityId: jobId,
        entityRef: job?.reference,
        metadata: { driverId, manual: opts?.manual ?? false },
      });
    } else if (job?.assigned_driver_id) {
      await supabase
        .from("drivers")
        .update({ status: "AVAILABLE" } as never)
        .eq("id", job.assigned_driver_id)
        .eq("status", "ON_ROUTE" as never);
    }

    // Refresh planned drive_minutes for affected driver(s)/day so compliance
    // caps reflect this manual assignment immediately.
    const day = job?.for_date;
    if (day) {
      const targets = new Set<string>();
      if (driverId) targets.add(driverId);
      if (job?.assigned_driver_id) targets.add(job.assigned_driver_id);
      for (const did of targets) void refreshHours({ data: { driverId: did, day } });
    }
  }

  const refreshData = useCallback(() => {
    void Promise.all([reloadJobs(), reloadJobStops()]);
  }, []);

  async function cloneJob(jobId: string) {
    const job = lookups.jobsById.get(jobId);
    if (!job) return;
    const stops = stopsMap[jobId] ?? [];
    try {
      const tenant_id = await getTenantId();
      const { data: nj, error } = await supabase
        .from("jobs")
        .insert({
          origin_warehouse_id: job.origin_warehouse_id,
          destination_warehouse_id: job.destination_warehouse_id,
          scheduled_at: job.scheduled_at,
          for_date: job.for_date,
          equipment_type: (job as { equipment_type?: string | null }).equipment_type ?? null,
          status: "PENDING",
          tenant_id,
        } as never)
        .select("id, reference")
        .single();
      if (error || !nj) {
        toast.error(error?.message ?? "Clone failed");
        return;
      }
      const newId = (nj as { id: string }).id;
      if (stops.length) {
        const { error: se } = await supabase.from("job_stops").insert(
          stops.map((s, i) => ({
            job_id: newId,
            seq: i + 1,
            kind: s.kind,
            warehouse_id: s.warehouse_id,
            scheduled_at: s.scheduled_at,
            tenant_id,
          })) as never,
        );
        if (se) toast.error(se.message);
      }
      await Promise.all([reloadJobs(), reloadJobStops()]);
      void logActivity("job.clone", {
        entityType: "job",
        entityId: newId,
        entityRef: (nj as { reference?: string }).reference,
        metadata: { clonedFrom: job.reference },
      });
      toast.success(`Cloned → ${(nj as { reference?: string }).reference ?? "new route"}`);
      setSelectedJobId(newId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clone failed");
    }
  }

  const runPlanJobs = useServerFn(planJobs);
  const refreshHours = useServerFn(refreshDriverDay);
  const [planning, setPlanning] = useState(false);
  async function onPlan() {
    if (planning) return;
    setPlanning(true);
    try {
      const r = await runPlanJobs();
      // Plan writes server-side via supabaseAdmin; don't wait on the realtime
      // echo — pull the fresh jobs + stops so the queue/detail repaint at once.
      await Promise.all([reloadJobs(), reloadJobStops()]);
      const msg = `Planned ${r.assigned}/${r.totalJobs} routes · ${r.driversPlanned} driver${r.driversPlanned === 1 ? "" : "s"}`;
      if (r.unassignable.length) toast.warning(`${msg} · ${r.unassignable.length} unassignable`);
      else toast.success(msg);
      void logActivity("plan.run", {
        entityType: "plan",
        metadata: { assigned: r.assigned, total: r.totalJobs, driversPlanned: r.driversPlanned },
      });
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
    if (status === "CANCELLED") {
      void logActivity("job.cancel", {
        entityType: "job",
        entityId: jobId,
        entityRef: job.reference,
      });
    }
    if (!opts?.silent) {
      if (status !== "CANCELLED") {
        void logActivity("job.status", {
          entityType: "job",
          entityId: jobId,
          entityRef: job.reference,
          metadata: { status },
        });
      }
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
          if (!match) {
            const laneCodes = (stopsMap[j.id] ?? [])
              .map((s) => lookups.warehousesById.get(s.warehouse_id)?.code ?? "")
              .filter(Boolean)
              .join("->")
              .toLowerCase();
            const nq = q.replace(/→/g, "->").replace(/\s+/g, "");
            if (laneCodes && nq.includes("->") && laneCodes.includes(nq)) match = true;
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
      if (tourDriverId) {
        return j.assigned_driver_id === tourDriverId || j.planned_driver_id === tourDriverId;
      }
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
      if (tourDriverId) {
        const sa = a.planned_sequence ?? 9999;
        const sb = b.planned_sequence ?? 9999;
        if (sa !== sb) return sa - sb;
      }
      const ta = jobDate(a, stopsMap[a.id] ?? []).getTime();
      const tb = jobDate(b, stopsMap[b.id] ?? []).getTime();
      return ta - tb;
    });
    return filtered;
  }, [jobsInRange, hiddenStatuses, statusFilter, stopsMap, tourDriverId]);

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
          <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-[color:color-mix(in_oklab,var(--color-background)_92%,transparent)] backdrop-blur-md">
            <style>{`@keyframes plan-slide{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}`}</style>
            <div className="size-9 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <div className="text-center">
              <p className="text-base font-semibold text-foreground mb-1">Planning Routes</p>
              <p className="text-xs text-muted-foreground font-mono">
                Assigning drivers — please wait, do not navigate away
              </p>
            </div>
            <div className="w-72 h-1 rounded-full bg-[color:var(--border)] overflow-hidden relative">
              <div
                className="absolute h-full w-[45%] rounded-full bg-[color:var(--primary-bright)]"
                style={{ animation: "plan-slide 1.4s cubic-bezier(0.4,0,0.6,1) infinite" }}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  const today = startOfDay(new Date());
  const isTodayRange =
    !!dateRange?.from &&
    sameDay(dateRange.from, today) &&
    sameDay(dateRange.to ?? dateRange.from, today);
  const isDefaultFilters =
    isTodayRange &&
    !tourDriverId &&
    !search &&
    !statusFilter &&
    hiddenStatuses.size === 2 &&
    hiddenStatuses.has("COMPLETED") &&
    hiddenStatuses.has("CANCELLED");

  const editingJob = editJobId ? (lookups.jobsById.get(editJobId) ?? null) : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {PlanningOverlay}

      <header
        className="px-5 py-3 border-b border-border grid grid-cols-[1fr_auto_1fr] items-center gap-4"
        style={
          accentColor
            ? {
                background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} 32%, var(--color-background) 100%)`,
              }
            : undefined
        }
      >
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Dispatch</h1>
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
            dataAiTarget="run-plan"
            icon={<BrainCircuit className="size-3.5" />}
          >
            {planning ? "Planning…" : "Planning"}
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setCreateOpen(true)}
            primary
            dataAiTarget="create-route"
            icon={<Truck className="size-3.5" />}
          >
            Create route
          </ToolbarButton>
        </div>
      </header>

      {/* Filter bar */}
      <div className="pl-3 pr-5 py-2.5 flex items-center gap-2 border-b border-[color:var(--sidebar-divider)] bg-[color:color-mix(in_oklab,var(--color-background)_60%,transparent)]">
        <div className="relative w-[340px]">
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

        <AuditPlanButton />
        <ImportBatchesButton />
        <ImportCsvButton />

        <div className="inline-flex items-center">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "group relative inline-flex items-center gap-2 h-9 pl-1 pr-3 rounded-full text-xs font-semibold text-white whitespace-nowrap overflow-hidden",
                  "shadow-[0_2px_6px_rgba(0,0,0,0.30)] transition-all active:scale-[0.97]",
                  "bg-gradient-to-b from-[#3a3a3a] to-[#0c0c0c] hover:from-[#474747] hover:to-[#171717]",
                )}
              >
                <span className="pointer-events-none absolute inset-x-1 top-px h-1/2 rounded-full bg-white/20" />
                <span className="relative grid size-7 place-items-center rounded-full ring-1 ring-white/15 bg-gradient-to-b from-[#2b2b2b] to-black shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_1px_2px_rgba(0,0,0,0.45)] [&_svg]:size-3.5">
                  <CalendarIcon className="size-3.5" />
                </span>
                <span className="relative leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                  {dateLabel}
                </span>
                <ChevronDown className="relative size-3 opacity-80" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
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

          {!isDefaultFilters && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter(null);
                setHiddenStatuses(new Set<JobStatus>(["COMPLETED", "CANCELLED"]));
                setDateRange({ from: today, to: today });
                setTourDriverId(null);
              }}
              title="Reset filters"
              className="px-2 py-1.5 border-l border-border text-muted-foreground transition-all hover:text-foreground hover:bg-input"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </div>
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
          onShowTour={(driverId) => {
            setTourDriverId((p) => (p === driverId ? null : driverId));
            setSearch("");
          }}
        />

        <div className="overflow-y-auto bg-background">
          {!selectedJob ? (
            <div className="h-full grid place-items-center">
              <div className="text-center">
                <div className="size-12 rounded-full grid place-items-center mx-auto mb-3 bg-secondary">
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
              driverShifts={driverShifts}
              shiftOverrides={shiftOverrides}
              onAssignDriver={(id) => assignDriver(selectedJob.id, id, { manual: true })}
              onSetStatus={(s, opts) => {
                void setStatus(selectedJob.id, s, opts);
              }}
              onEdit={() => setEditJobId(selectedJob.id)}
              onClone={() => cloneJob(selectedJob.id)}
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
                handling_minutes: (editingJob as { handling_minutes?: number | null })
                  .handling_minutes,
                estimated_cost: (editingJob as { estimated_cost?: string | null }).estimated_cost,
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
