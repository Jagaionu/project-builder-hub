import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, useLayoutEffect, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useJobs, useWarehouses, useDrivers, useCompliance } from "@/lib/hooks";
import type { Compliance } from "@/lib/compliance";

import { PageHeader } from "./_app.index";
import {
  Plus,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  MapPin,
  Clock,
  ChevronRight,
  Check,
  User,
  Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyDriverOfJob } from "@/lib/telegram-notify.functions";
import { computePlan, AUTO_ASSIGN_RADIUS_KM } from "@/lib/planner";
import { computeStopSchedule, legMinutes } from "@/lib/geo";
import { importJobsCsv } from "@/lib/jobs-import.functions";
import { csvToImportRows } from "@/lib/csv-import";

const ACTIVE_JOB_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);
void AUTO_ASSIGN_RADIUS_KM;
void ACTIVE_JOB_STATUSES;

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
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50 transition-colors"
      >
        <Upload className="size-4" /> {busy ? "Importing…" : "Import CSV"}
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
  PENDING: { label: "Pending", dot: "bg-amber-400", badge: "text-amber-500 bg-amber-500/10" },
  ASSIGNED: { label: "Assigned", dot: "bg-blue-400", badge: "text-blue-500 bg-blue-500/10" },
  IN_PROGRESS: { label: "In Progress", dot: "bg-violet-400", badge: "text-violet-500 bg-violet-500/10" },
  ARRIVED_PICKUP: { label: "Arrived Pickup", dot: "bg-cyan-400", badge: "text-cyan-500 bg-cyan-500/10" },
  EN_ROUTE_DELIVERY: { label: "En Route Delivery", dot: "bg-indigo-400", badge: "text-indigo-500 bg-indigo-500/10" },
  COMPLETED: { label: "Completed", dot: "bg-emerald-400", badge: "text-emerald-600 bg-emerald-500/10" },
  CANCELLED: { label: "Cancelled", dot: "bg-zinc-400", badge: "text-zinc-400 bg-zinc-500/10" },
};

function JobsPage() {
  const jobs = useJobs();
  const warehouses = useWarehouses();
  const drivers = useDrivers();
  const stopsMap = useJobStops();
  const compliance = useCompliance();
  const [createOpen, setCreateOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const notify = useServerFn(notifyDriverOfJob);
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<JobStatus>>(() => {
    if (typeof window === "undefined") return new Set(["COMPLETED", "CANCELLED"]);
    try {
      const raw = localStorage.getItem("jobs.hiddenStatuses");
      if (raw) return new Set(JSON.parse(raw) as JobStatus[]);
    } catch {
      /* ignore */
    }
    return new Set(["COMPLETED", "CANCELLED"]);
  });
  useEffect(() => {
    try {
      localStorage.setItem("jobs.hiddenStatuses", JSON.stringify(Array.from(hiddenStatuses)));
    } catch {
      /* ignore */
    }
  }, [hiddenStatuses]);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!statusMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [statusMenuOpen]);
  const visibleJobs = useMemo(
    () => jobs.filter((j) => !hiddenStatuses.has(j.status as JobStatus)),
    [jobs, hiddenStatuses],
  );
  const statusCounts = useMemo(() => {
    const m: Partial<Record<JobStatus, number>> = {};
    for (const j of jobs) m[j.status as JobStatus] = (m[j.status as JobStatus] ?? 0) + 1;
    return m;
  }, [jobs]);
  function toggleStatus(s: JobStatus) {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }
  const plan = useMemo(
    () => computePlan(jobs, stopsMap, drivers, warehouses, compliance),
    [jobs, stopsMap, drivers, warehouses, compliance],
  );
  const plannedByJob = useMemo(() => new Map(plan.planned.map((item) => [item.jobId, item] as const)), [plan]);

  useEffect(() => {
    const inconsistent = jobs.filter((j) => !j.assigned_driver_id && ACTIVE_JOB_STATUSES.has(j.status));
    if (inconsistent.length === 0) return;
    void (async () => {
      for (const job of inconsistent) {
        const { error } = await supabase
          .from("jobs")
          .update({ status: "PENDING" as never })
          .eq("id", job.id);
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
        if ((r as { skipped?: string }).skipped === "driver_no_telegram")
          toast.warning("Driver has no Telegram linked");
        else toast.success("Driver notified on Telegram");
      } catch (e) {
        toast.error(`Notify failed: ${(e as Error).message}`);
      }
    }
  }

  const planSigRef = useRef<string>("");
  useEffect(() => {
    if (drivers.length === 0 || warehouses.length === 0) return;
    const pending = jobs.filter((j) => j.status === "PENDING" && !j.assigned_driver_id);
    if (pending.some((j) => !stopsMap[j.id])) return;

    const plan = computePlan(jobs, stopsMap, drivers, warehouses, compliance);
    const sig = JSON.stringify({
      i: plan.immediate.map((x) => [x.jobId, x.driverId]),
      p: plan.planned.map((x) => [x.jobId, x.driverId, x.sequence, x.startAt]),
    });
    if (sig === planSigRef.current) return;
    planSigRef.current = sig;

    (async () => {
      for (const a of plan.immediate) {
        const job = jobs.find((j) => j.id === a.jobId);
        const driver = drivers.find((d) => d.id === a.driverId);
        if (!job || !driver) continue;
        await assignDriver(a.jobId, a.driverId);
        toast.message(`Auto-assigned ${driver.name} → ${job.reference} (${a.distKm.toFixed(1)} km)`);
        await fillStopTimes(a.jobId, job.scheduled_at ?? new Date().toISOString(), stopsMap[a.jobId] ?? [], warehouses);
      }

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
        if (!want) {
          if (have.d || have.s || have.t) {
            await supabase
              .from("jobs")
              .update({ planned_driver_id: null, planned_sequence: null, planned_start_at: null })
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
    const { error } = await supabase
      .from("jobs")
      .update({ status: status as never })
      .eq("id", jobId);
    if (error) toast.error(error.message);
    else toast.success(`Status → ${STATUS_CONFIG[status as JobStatus]?.label ?? status}`);
  }

  const editingJob = editJobId ? jobs.find((j) => j.id === editJobId) : null;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Jobs"
        subtitle="Multi-stop routes — click a row to edit or delete"
        right={
          <div className="flex items-center gap-3">
            <div className="relative" ref={statusMenuRef}>
              <button
                onClick={() => setStatusMenuOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 transition-colors"
              >
                Statuses
                <span className="font-mono text-xs text-muted-foreground">
                  {JOB_STATUSES.length - hiddenStatuses.size}/{JOB_STATUSES.length}
                </span>
                <ChevronDown className="size-4" />
              </button>
              {statusMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-surface shadow-lg z-50 p-2">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Show statuses
                    </span>
                    <button
                      onClick={() => setHiddenStatuses(new Set(["COMPLETED", "CANCELLED"]))}
                      className="text-xs text-primary hover:underline"
                    >
                      Reset
                    </button>
                  </div>
                  {JOB_STATUSES.map((s) => {
                    const cfg = STATUS_CONFIG[s];
                    const checked = !hiddenStatuses.has(s);
                    return (
                      <button
                        key={s}
                        onClick={() => toggleStatus(s)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2 text-sm text-left"
                      >
                        <span
                          className={`size-4 rounded border flex items-center justify-center ${
                            checked ? "bg-primary border-primary" : "border-border"
                          }`}
                        >
                          {checked && <Check className="size-3 text-primary-foreground" />}
                        </span>
                        <span className={`size-2 rounded-full ${cfg.dot}`} />
                        <span className="flex-1">{cfg.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {statusCounts[s] ?? 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <ImportCsvButton />
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus className="size-4" /> Create route
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-16 text-center backdrop-blur">
            <MapPin className="size-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground font-medium">No routes yet.</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus className="size-4" /> Create your first route
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-background/50 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <div className="col-span-2">Reference</div>
              <div className="col-span-4">Route</div>
              <div className="col-span-2">Driver</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Scheduled / ETA</div>
            </div>
            {/* Rows */}
            {visibleJobs.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                All {jobs.length} job{jobs.length === 1 ? "" : "s"} are hidden by the status filter.
              </div>
            ) : null}
            {visibleJobs.map((j, idx) => {
              const stops = stopsMap[j.id] ?? [];
              const planned = plannedByJob.get(j.id);
              return (
                <div
                  key={j.id}
                  onClick={() => setEditJobId(j.id)}
                  className={`grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-surface-2/50 cursor-pointer transition-colors group ${
                    idx !== visibleJobs.length - 1 ? "border-b border-border/60" : ""
                  }`}
                >
                  <div className="col-span-2">
                    <div className="font-mono text-sm font-medium text-foreground">{j.reference}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{stops.length} stops</div>
                  </div>
                  <div className="col-span-4">
                    <div className="flex items-center gap-1 flex-wrap">
                      {stops.length === 0 ? (
                        <span className="text-sm text-muted-foreground/40 italic">No stops</span>
                      ) : (
                        stops.map((s, idx) => {
                          const wh = warehouses.find((w) => w.id === s.warehouse_id);
                          const code = wh?.code ?? "?";
                          const next = stops[idx + 1];
                          const nextWh = next ? warehouses.find((w) => w.id === next.warehouse_id) : null;
                          const leg = wh && nextWh ? legMinutes(s, wh, nextWh) : null;
                          return (
                            <span key={idx} className="flex items-center gap-1">
                              <span
                                className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-mono text-xs font-medium ${
                                  s.kind === "PICKUP"
                                    ? "bg-blue-500/10 text-blue-500"
                                    : "bg-emerald-500/10 text-emerald-600"
                                }`}
                              >
                                {code}
                              </span>
                              {leg && (
                                <span className="flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground/60 px-1">
                                  {leg.loadingMin > 0 && (
                                    <span title="Loading at pickup" className="text-amber-500/80">
                                      +{leg.loadingMin}m load
                                    </span>
                                  )}
                                  <ChevronRight className="size-3 text-muted-foreground/30 shrink-0" />
                                  <span title={`${leg.km.toFixed(1)} km`}>ETA {leg.transitMin}m</span>
                                  <ChevronRight className="size-3 text-muted-foreground/30 shrink-0" />
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
                        driverName={
                          drivers.find((d) => d.id === (planned?.driverId ?? j.planned_driver_id))?.name ?? "?"
                        }
                        sequence={planned?.sequence ?? j.planned_sequence ?? undefined}
                        startAt={planned?.startAt ?? j.planned_start_at ?? undefined}
                        distanceKm={planned?.distKm}
                        dailyHoursLeft={planned?.dailyHoursLeft}
                      />
                    )}
                  </div>
                  <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
                    <StatusPill status={j.status} onChange={(s) => setStatus(j.id, s)} />
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground">
                    {j.scheduled_at && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3.5" />
                        {new Date(j.scheduled_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                    {j.eta_minutes != null && <span className="font-mono text-xs">ETA {j.eta_minutes}m</span>}
                    {!j.scheduled_at && j.eta_minutes == null && <span className="text-muted-foreground/40">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {createOpen && <RouteDialog mode="create" onClose={() => setCreateOpen(false)} warehouses={warehouses} />}
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
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 select-none ${cfg.badge}`}
      >
        <span className={`size-2 rounded-full shrink-0 ${cfg.dot}`} />
        {cfg.label}
      </button>
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-[1000] w-48 rounded-2xl border border-border bg-popover shadow-xl py-2 animate-in fade-in"
          >
            {JOB_STATUSES.map((s) => {
              const c = STATUS_CONFIG[s];
              const active = s === status;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-2 transition-colors"
                >
                  <span className={`size-2.5 rounded-full shrink-0 ${c.dot}`} />
                  <span
                    className={`flex-1 text-left ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    {c.label}
                  </span>
                  {active && <Check className="size-4 text-foreground" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

function DriverPicker({
  driverId,
  allowUnassign = true,
  drivers,
  compliance,
  onChange,
}: {
  driverId: string | null | undefined;
  allowUnassign?: boolean;
  drivers: { id: string; name: string; telegram_id?: string | null }[];
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
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        {driver ? (
          <>
            <span className="size-7 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0">
              {driver.name[0]?.toUpperCase()}
            </span>
            <span className="text-sm font-medium text-foreground truncate max-w-[100px]">{driver.name}</span>
            {activeC && <ComplianceDot c={activeC} />}
            {!driver.telegram_id && <span className="text-[10px] text-muted-foreground/60 font-mono">no TG</span>}
          </>
        ) : (
          <>
            <span className="size-7 rounded-full border border-dashed border-border flex items-center justify-center shrink-0">
              <User className="size-3.5 text-muted-foreground/50" />
            </span>
            <span className="text-sm text-muted-foreground">Unassigned</span>
          </>
        )}
      </button>
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-[1000] w-56 rounded-2xl border border-border bg-popover shadow-xl py-2 max-h-[60vh] overflow-y-auto animate-in fade-in"
          >
            {allowUnassign && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-2 transition-colors"
                >
                  <span className="size-7 rounded-full border border-dashed border-border flex items-center justify-center shrink-0">
                    <User className="size-3.5 text-muted-foreground/40" />
                  </span>
                  <span
                    className={`flex-1 text-left ${!driverId ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    Unassigned
                  </span>
                  {!driverId && <Check className="size-4 text-foreground" />}
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
                  onClick={() => {
                    if (!blocked) {
                      onChange(d.id);
                      setOpen(false);
                    }
                  }}
                  title={blocked ? dc?.issues.find((i) => i.level === "breach")?.msg : undefined}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                    blocked ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="size-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                    {d.name[0]?.toUpperCase()}
                  </span>
                  <span
                    className={`flex-1 text-left ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    {d.name}
                    {!d.telegram_id && <span className="ml-1 text-[10px] text-muted-foreground/50">no TG</span>}
                    {dc && (
                      <span className="ml-1 text-[10px] font-mono text-muted-foreground/70">
                        {dc.weekly.toFixed(0)}/56 · {dc.dailyHeadroom.toFixed(1)}h left
                      </span>
                    )}
                  </span>
                  {dc && <ComplianceDot c={dc} />}
                  {active && <Check className="size-4 text-foreground" />}
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
        .from("jobs")
        .insert(jobPayload as never)
        .select("id")
        .single();
      if (error) {
        setSaving(false);
        console.error("[jobs.insert]", error);
        return toast.error(`Job create failed: ${error.message}`);
      }
      targetJobId = (data as { id: string }).id;
    } else {
      const { error } = await supabase.from("jobs").update(jobPayload).eq("id", targetJobId!);
      if (error) {
        setSaving(false);
        console.error("[jobs.update]", error);
        return toast.error(`Job update failed: ${error.message}`);
      }
    }

    const { error: delErr } = await supabase.from("job_stops").delete().eq("job_id", targetJobId!);
    if (delErr) {
      setSaving(false);
      console.error("[stops.delete]", delErr);
      return toast.error(`Clear stops failed: ${delErr.message}`);
    }

    const rows = stops.map((s, i) => ({
      job_id: targetJobId!,
      seq: i,
      kind: s.kind as never,
      warehouse_id: s.warehouse_id,
      scheduled_at: s.scheduled_at ?? autoTimes[i] ?? null,
    }));
    const { error: stopErr } = await supabase.from("job_stops").insert(rows as never);
    setSaving(false);
    if (stopErr) {
      console.error("[stops.insert]", stopErr, rows);
      return toast.error(`Stops insert failed: ${stopErr.message}`);
    }

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">{mode === "create" ? "Create route" : "Edit route"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="p-6 space-y-5 overflow-y-auto">
          <div>
            <Field label="Scheduled (optional)">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </Field>
            <p className="mt-2 text-xs text-muted-foreground">
              Driver is assigned from the jobs list once the route is created.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stops</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => addStop("PICKUP")}
                  className="text-xs rounded-lg border border-border bg-surface px-3 py-1.5 hover:bg-surface-2 transition-colors"
                >
                  + Pickup
                </button>
                <button
                  type="button"
                  onClick={() => addStop("DROP")}
                  className="text-xs rounded-lg border border-border bg-surface px-3 py-1.5 hover:bg-surface-2 transition-colors"
                >
                  + Drop
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {stops.map((s, i) => {
                const auto = computedTimes[i];
                const showAuto = !s.scheduled_at && auto;
                return (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3">
                    <span className="font-mono text-sm text-muted-foreground w-6 text-right">{i + 1}.</span>
                    <select
                      value={s.kind}
                      onChange={(e) => update(i, { kind: e.target.value as "PICKUP" | "DROP" })}
                      className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm"
                    >
                      <option value="PICKUP">📦 Pickup</option>
                      <option value="DROP">🏁 Drop</option>
                    </select>
                    <select
                      required
                      value={s.warehouse_id}
                      onChange={(e) => update(i, { warehouse_id: e.target.value })}
                      className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm"
                    >
                      <option value="">Select warehouse…</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-col items-end">
                      <input
                        type="datetime-local"
                        value={s.scheduled_at ? toLocalInput(s.scheduled_at) : auto ? toLocalInput(auto) : ""}
                        onChange={(e) =>
                          update(i, {
                            scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                          })
                        }
                        className={`bg-surface border border-border rounded-lg px-3 py-1.5 text-sm ${
                          showAuto ? "text-muted-foreground italic" : ""
                        }`}
                        title={
                          showAuto
                            ? "Auto-calculated from previous stop + driving + loading"
                            : "Time window for this stop"
                        }
                      />
                      {showAuto && <span className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">auto</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="p-1.5 rounded-lg hover:bg-surface-2 disabled:opacity-30 transition-colors"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === stops.length - 1}
                      className="p-1.5 rounded-lg hover:bg-surface-2 disabled:opacity-30 transition-colors"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStop(i)}
                      disabled={stops.length <= 2}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 disabled:opacity-30 transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex justify-between gap-3 px-6 py-4 border-t border-border bg-surface-2/20">
          <div>
            {mode === "edit" && (
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-xl bg-destructive/10 text-destructive px-4 py-2 text-sm font-medium hover:bg-destructive/20 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="size-4" /> {deleting ? "Deleting…" : "Delete lane"}
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
            >
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
      <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</span>
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
      className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-0.5 text-xs font-mono text-muted-foreground"
    >
      <span className="size-1.5 rounded-full bg-muted-foreground/60" />
      planned: {driverName}
      {sequence ? ` · #${sequence}` : ""}
      {when ? ` · ${when}` : ""}
      {distanceKm != null ? ` · ${distanceKm.toFixed(0)}km away` : ""}
      {dailyHoursLeft != null ? ` · ${dailyHoursLeft.toFixed(1)}h left` : ""}
    </div>
  );
}

function ComplianceDot({ c }: { c: Compliance }) {
  const cls = c.status === "breach" ? "bg-destructive" : c.status === "warn" ? "bg-warning" : "bg-success";
  const title = c.issues[0]?.msg ?? `OK · ${c.daily.toFixed(1)}/10 today · ${c.weekly.toFixed(1)}/56 this week`;
  return <span title={title} className={`size-2 rounded-full shrink-0 ${cls}`} />;
}
