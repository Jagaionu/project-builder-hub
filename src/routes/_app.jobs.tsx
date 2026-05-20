import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useJobs, useWarehouses, useDrivers } from "@/lib/hooks";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "./_app.index";
import { ArrowRight, Plus, Trash2, X, ChevronUp, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyDriverOfJob, notifyDriverJobUpdate } from "@/lib/telegram-notify.functions";

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
  const notifyUpdate = useServerFn(notifyDriverJobUpdate);

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("jobs").update({ status: status as never }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Status → ${status}`);
    if (status === "CANCELLED") {
      try { await notifyUpdate({ data: { jobId: id, message: "❌ Job cancelled by dispatch." } }); } catch {}
    }
  }

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

  const editingJob = editJobId ? jobs.find((j) => j.id === editJobId) : null;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Jobs"
        subtitle="Multi-stop routes, manual assignment, edit & delete"
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
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Ref</th>
                <th className="px-3 py-2 text-left">Route</th>
                <th className="px-3 py-2 text-left">Driver</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">ETA</th>
                <th className="px-3 py-2 text-left">Scheduled</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((j) => {
                const stops = stopsMap[j.id] ?? [];
                const chain = stops
                  .map((s) => warehouses.find((w) => w.id === s.warehouse_id)?.code ?? "?")
                  .join(" → ");
                return (
                  <tr
                    key={j.id}
                    className="hover:bg-surface-2/40 cursor-pointer"
                    onClick={() => setEditJobId(j.id)}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs">{j.reference}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {chain || <span className="text-muted-foreground">no stops</span>}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={j.assigned_driver_id ?? ""}
                        onChange={(e) => assignDriver(j.id, e.target.value)}
                        className="text-xs bg-surface border border-border rounded px-1.5 py-1 min-w-[140px]"
                      >
                        <option value="">— unassigned —</option>
                        {drivers.map((dr) => (
                          <option key={dr.id} value={dr.id}>
                            {dr.name}{dr.telegram_id ? "" : " (no TG)"}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={j.status} kind="job" /></td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{j.eta_minutes ? `${j.eta_minutes}m` : "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{j.scheduled_at ? new Date(j.scheduled_at).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <ArrowRight className="inline size-3.5 text-muted-foreground" />
                    </td>
                  </tr>
                );
              })}
              {jobs.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-xs">No jobs yet. Click "Create route" to add one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <RouteDialog
          mode="create"
          onClose={() => setCreateOpen(false)}
          warehouses={warehouses}
          drivers={drivers}
        />
      )}
      {editingJob && (
        <RouteDialog
          mode="edit"
          jobId={editingJob.id}
          initial={{
            driver_id: editingJob.assigned_driver_id ?? "",
            scheduled_at: editingJob.scheduled_at,
            stops: stopsMap[editingJob.id] ?? [],
          }}
          onClose={() => setEditJobId(null)}
          warehouses={warehouses}
          drivers={drivers}
        />
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
  drivers,
}: {
  mode: "create" | "edit";
  jobId?: string;
  initial?: { driver_id: string; scheduled_at: string | null; stops: Stop[] };
  onClose: () => void;
  warehouses: ReturnType<typeof useWarehouses>;
  drivers: ReturnType<typeof useDrivers>;
}) {
  const notify = useServerFn(notifyDriverOfJob);
  const [driverId, setDriverId] = useState(initial?.driver_id ?? "");
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
      assigned_driver_id: driverId || null,
      status: (driverId ? "ASSIGNED" : "PENDING") as never,
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
    if (driverId && targetJobId) {
      try { await notify({ data: { jobId: targetJobId } }); } catch {}
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
          <div className="grid grid-cols-2 gap-4">
            <Field label="Driver (optional)">
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm">
                <option value="">Unassigned</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.telegram_id ? "" : " (no TG)"}</option>)}
              </select>
            </Field>
            <Field label="Scheduled (optional)">
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm" />
            </Field>
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
