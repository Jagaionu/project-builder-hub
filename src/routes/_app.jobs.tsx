import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useJobs, useWarehouses, useDrivers, useCompliance } from "@/lib/hooks";
import type { Compliance } from "@/lib/compliance";

import { PageHeader } from "./_app.index";
import { Plus, Trash2, X, ChevronUp, ChevronDown, MapPin, Clock, ChevronRight, Check, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyDriverOfJob } from "@/lib/telegram-notify.functions";
import { computePlan, AUTO_ASSIGN_RADIUS_KM } from "@/lib/planner";
import { computeStopSchedule, legMinutes } from "@/lib/geo";

const ACTIVE_JOB_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);
void AUTO_ASSIGN_RADIUS_KM;
void ACTIVE_JOB_STATUSES;


export const Route = createFileRoute("/_app/jobs")({
  component: JobsPage,
  head: () => ({ meta: [{ title: "Jobs — Planning System" }] }),
});


type Stop = {
  id?: string;
  kind: "PICKUP" | "DROP";
  warehouse_id: string;
  scheduled_at: string | null;
};

type JobStopsMap = Record<string, Stop[]>;

function useJobStops(): JobStopsMap {
  const [map, setMap] = useState<JobStopsMap>({});
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("job_stops")
        .select("id,job_id,kind,warehouse_id,scheduled_at,seq")
        .order("seq", { ascending: true });
      if (!mounted) return;
      const m: JobStopsMap = {};
      for (const s of (data ?? []) as Array<{ job_id: string } & Stop & { seq: number }>) {
        (m[s.job_id] ||= []).push({
          id: s.id,
          kind: s.kind,
          warehouse_id: s.warehouse_id,
          scheduled_at: s.scheduled_at,
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

function JobsPage() {
  const jobs = useJobs();
  const warehouses = useWarehouses();
  const drivers = useDrivers();
  const stopsMap = useJobStops();
  const compliance = useCompliance();
  const [createOpen, setCreateOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const notify = useServerFn(notifyDriverOfJob);

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
        }
      }
    })();
    // Note: assignDriver excluded from deps — it's stable enough for this effect's purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, stopsMap, drivers, warehouses, compliance]);


  // status config moved to module level

  async function setStatus(jobId: string, status: string) {
    const { error } = await supabase.from("jobs").update({ status: status as never }).eq("id", jobId);
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
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-3.5" /> Create route
          </button>
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
              {jobs.map((j) => {
                const stops = stopsMap[j.id] ?? [];
                const whNames = stops.map((s) => {
                  const wh = warehouses.find((w) => w.id === s.warehouse_id);
                  return { code: wh?.code ?? "?", kind: s.kind };
                });
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
                        {whNames.length === 0 ? (
                          <span className="text-xs text-muted-foreground/50 italic">No stops</span>
                        ) : (
                          whNames.map(({ code, kind }, idx) => (
                            <span key={idx} className="flex items-center gap-1">
                              <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                                kind === "PICKUP"
                                  ? "bg-blue-500/10 text-blue-500"
                                  : "bg-emerald-500/10 text-emerald-600"
                              }`}>
                                {code}
                              </span>
                              {idx < whNames.length - 1 && (
                                <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
                              )}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
                      <DriverPicker
                        driverId={j.assigned_driver_id}
                        drivers={drivers}
                        compliance={compliance}
                        onChange={(id) => assignDriver(j.id, id)}
                      />
                      {!j.assigned_driver_id && j.planned_driver_id && (
                        <PlannedChip
                          driverName={drivers.find((d) => d.id === j.planned_driver_id)?.name ?? "?"}
                          sequence={j.planned_sequence ?? undefined}
                          startAt={j.planned_start_at ?? undefined}
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
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return { open, setOpen, ref };
}

function StatusPill({ status, onChange }: { status: string; onChange: (s: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const cfg = STATUS_CONFIG[status as JobStatus] ?? STATUS_CONFIG.PENDING;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 select-none ${cfg.badge}`}
      >
        <span className={`size-1.5 rounded-full shrink-0 ${cfg.dot}`} />
        {cfg.label}
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full mt-1.5 z-30 w-48 rounded-xl border border-border bg-popover shadow-xl py-1.5"
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
        </div>
      )}
    </div>
  );
}

function DriverPicker({ driverId, drivers, compliance, onChange }: {
  driverId: string | null | undefined;
  drivers: { id: string; name: string; telegram_id?: string | null }[];
  compliance?: Record<string, Compliance>;
  onChange: (id: string) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const driver = drivers.find((d) => d.id === driverId);
  const activeC = driver ? compliance?.[driver.id] : undefined;
  return (
    <div ref={ref} className="relative">
      <button
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
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full mt-1.5 z-30 w-52 rounded-xl border border-border bg-popover shadow-xl py-1.5"
        >
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
        </div>
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
    initial?.scheduled_at ? toLocalInput(initial.scheduled_at) : "",
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

    const jobPayload = {
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      // Keep legacy fields populated with first/last for backward compatibility
      origin_warehouse_id: stops[0].warehouse_id,
      destination_warehouse_id: stops[stops.length - 1].warehouse_id,
    };

    let targetJobId = jobId;
    if (mode === "create") {
      const { data, error } = await supabase
        .from("jobs").insert(jobPayload as never).select("id").single();
      if (error) { setSaving(false); return toast.error(error.message); }
      targetJobId = data.id as string;
    } else {
      const { error } = await supabase.from("jobs").update(jobPayload).eq("id", targetJobId!);
      if (error) { setSaving(false); return toast.error(error.message); }
    }

    // Replace stops
    await supabase.from("job_stops").delete().eq("job_id", targetJobId!);
    const rows = stops.map((s, i) => ({
      job_id: targetJobId!,
      seq: i,
      kind: s.kind as never,
      warehouse_id: s.warehouse_id,
      scheduled_at: s.scheduled_at,
    }));
    const { error: stopErr } = await supabase.from("job_stops").insert(rows as never);
    setSaving(false);
    if (stopErr) return toast.error(stopErr.message);

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
              {stops.map((s, i) => (
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
                  <input
                    type="datetime-local"
                    value={s.scheduled_at ? toLocalInput(s.scheduled_at) : ""}
                    onChange={(e) => update(i, { scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                    className="bg-surface border border-border rounded px-2 py-1 text-xs"
                    title="Optional time window for this stop"
                  />
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 hover:bg-surface-2 rounded disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === stops.length - 1} className="p-1 hover:bg-surface-2 rounded disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                  <button type="button" onClick={() => removeStop(i)} disabled={stops.length <= 2} className="p-1 hover:bg-destructive/20 rounded disabled:opacity-30"><Trash2 className="size-3.5" /></button>
                </div>
              ))}
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
}: {
  driverName: string;
  sequence?: number;
  startAt?: string;
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
    </div>
  );
}


function ComplianceDot({ c }: { c: Compliance }) {
  const cls =
    c.status === "breach"
      ? "bg-destructive"
      : c.status === "warn"
        ? "bg-warning"
        : "bg-success";
  const title =
    c.issues[0]?.msg ?? `OK · ${c.daily.toFixed(1)}/10 today · ${c.weekly.toFixed(1)}/56 this week`;
  return <span title={title} className={`size-1.5 rounded-full shrink-0 ${cls}`} />;
}
