import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useJobs, useWarehouses, useDrivers } from "@/lib/hooks";

import { PageHeader } from "./_app.index";
import { Plus, Trash2, X, ChevronUp, ChevronDown, MapPin, Package, Flag, Clock, User, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyDriverOfJob } from "@/lib/telegram-notify.functions";

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

function JobsPage() {
  const jobs = useJobs();
  const warehouses = useWarehouses();
  const drivers = useDrivers();
  const stopsMap = useJobStops();
  const [createOpen, setCreateOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const notify = useServerFn(notifyDriverOfJob);

  async function assignDriver(jobId: string, driverId: string) {
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

  const JOB_STATUSES = [
    "PENDING", "ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP",
    "EN_ROUTE_DELIVERY", "COMPLETED", "CANCELLED",
  ] as const;

  const STATUS_STYLES: Record<string, string> = {
    PENDING: "bg-warning/15 text-warning border-warning/30",
    ASSIGNED: "bg-info/15 text-info border-info/30",
    IN_PROGRESS: "bg-primary/15 text-primary border-primary/30",
    ARRIVED_PICKUP: "bg-accent/15 text-accent border-accent/30",
    EN_ROUTE_DELIVERY: "bg-primary/15 text-primary border-primary/30",
    COMPLETED: "bg-success/15 text-success border-success/30",
    CANCELLED: "bg-muted text-muted-foreground border-border",
  };

  async function setStatus(jobId: string, status: string) {
    const { error } = await supabase.from("jobs").update({ status: status as never }).eq("id", jobId);
    if (error) toast.error(error.message);
    else toast.success(`Status → ${status.replace(/_/g, " ")}`);
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
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {jobs.map((j) => {
              const stops = stopsMap[j.id] ?? [];
              return (
                <div
                  key={j.id}
                  onClick={() => setEditJobId(j.id)}
                  className="group relative rounded-lg border border-border bg-surface hover:border-primary/60 hover:shadow-md transition cursor-pointer p-4 flex flex-col gap-3"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground">{j.reference}</div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70 mt-0.5">
                        {stops.length} {stops.length === 1 ? "stop" : "stops"}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-primary">
                      <Pencil className="size-3" /> Edit
                    </div>
                  </div>

                  {/* Stops chain */}
                  <div className="space-y-1.5">
                    {stops.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic">No stops configured</div>
                    ) : (
                      stops.map((s, idx) => {
                        const wh = warehouses.find((w) => w.id === s.warehouse_id);
                        const Icon = s.kind === "PICKUP" ? Package : Flag;
                        return (
                          <div key={idx} className="flex items-center gap-2 text-xs">
                            <Icon className={`size-3.5 shrink-0 ${s.kind === "PICKUP" ? "text-info" : "text-success"}`} />
                            <span className="font-mono text-foreground">{wh?.code ?? "?"}</span>
                            <span className="text-muted-foreground truncate">{wh?.name ?? ""}</span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground border-t border-border pt-2">
                    {j.scheduled_at && (
                      <span className="inline-flex items-center gap-1"><Clock className="size-3" />{new Date(j.scheduled_at).toLocaleString()}</span>
                    )}
                    {j.eta_minutes != null && (
                      <span className="inline-flex items-center gap-1 font-mono">ETA {j.eta_minutes}m</span>
                    )}
                  </div>

                  {/* Driver + Status controls */}
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex-1 relative">
                      <User className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <select
                        value={j.assigned_driver_id ?? ""}
                        onChange={(e) => assignDriver(j.id, e.target.value)}
                        className="w-full text-xs bg-background text-foreground border border-border rounded-md pl-7 pr-2 py-1.5 cursor-pointer hover:border-primary focus:border-primary outline-none"
                      >
                        <option value="">Unassigned</option>
                        {drivers.map((dr) => (
                          <option key={dr.id} value={dr.id}>
                            {dr.name}{dr.telegram_id ? "" : " (no TG)"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <StatusMenu
                      status={j.status}
                      onChange={(s) => setStatus(j.id, s)}
                      statuses={JOB_STATUSES as unknown as string[]}
                      styles={STATUS_STYLES}
                    />
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

function StatusMenu({
  status, onChange, statuses, styles,
}: {
  status: string;
  onChange: (s: string) => void;
  statuses: string[];
  styles: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[10px] font-mono uppercase tracking-wider hover:opacity-80 ${styles[status] ?? ""}`}
      >
        <span className="size-1.5 rounded-full bg-current" />
        {status.replace(/_/g, " ")}
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 z-20 min-w-[170px] rounded-md border border-border bg-popover shadow-lg py-1"
        >
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider hover:bg-surface-2 flex items-center gap-2 ${s === status ? "font-bold" : ""}`}
            >
              <span className={`size-1.5 rounded-full ${styles[s]?.split(" ").find(c => c.startsWith("text-")) ?? ""}`} style={{ backgroundColor: "currentColor" }} />
              {s.replace(/_/g, " ")}
            </button>
          ))}
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
