import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useJobs, useWarehouses, useDrivers } from "@/lib/hooks";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "./_app.index";
import { ArrowRight, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyDriverOfJob, notifyDriverJobUpdate } from "@/lib/telegram-notify.functions";

export const Route = createFileRoute("/_app/jobs")({
  component: JobsPage,
  head: () => ({ meta: [{ title: "Jobs — Planning System" }] }),
});

const lifecycle: { value: string; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "En route → pickup" },
  { value: "ARRIVED_PICKUP", label: "Arrived pickup" },
  { value: "EN_ROUTE_DELIVERY", label: "En route → delivery" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

function JobsPage() {
  const jobs = useJobs();
  const warehouses = useWarehouses();
  const drivers = useDrivers();
  const [open, setOpen] = useState(false);
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
        if ((r as { skipped?: string }).skipped === "driver_no_telegram") {
          toast.warning("Driver has no Telegram linked yet");
        } else {
          toast.success("Driver notified on Telegram");
        }
      } catch (e) {
        toast.error(`Notify failed: ${(e as Error).message}`);
      }
    }
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Jobs"
        subtitle="Complete job lifecycle and status overrides"
        right={
          <button
            onClick={() => setOpen(true)}
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
                <th className="px-3 py-2 text-right">Advance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((j) => {
                const o = warehouses.find((w) => w.id === j.origin_warehouse_id);
                const d = warehouses.find((w) => w.id === j.destination_warehouse_id);
                
                return (
                  <tr key={j.id} className="hover:bg-surface-2/40">
                    <td className="px-3 py-2.5 font-mono text-xs">{j.reference}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      <span>{o?.code ?? "?"}</span>
                      <ArrowRight className="inline size-3 mx-1.5 text-muted-foreground" />
                      <span>{d?.code ?? "?"}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={j.assigned_driver_id ?? ""}
                        onChange={(e) => assignDriver(j.id, e.target.value)}
                        className="text-xs bg-surface border border-border rounded px-1.5 py-1"
                      >
                        <option value="">— unassigned —</option>
                        {drivers.map((dr) => <option key={dr.id} value={dr.id}>{dr.name}{dr.telegram_id ? "" : " (no TG)"}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={j.status} kind="job" /></td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{j.eta_minutes ? `${j.eta_minutes}m` : "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{j.scheduled_at ? new Date(j.scheduled_at).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <select
                        value={j.status}
                        onChange={(e) => setStatus(j.id, e.target.value)}
                        className="text-xs bg-surface border border-border rounded px-1.5 py-1"
                      >
                        {lifecycle.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
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

      {open && <CreateRouteDialog onClose={() => setOpen(false)} warehouses={warehouses} drivers={drivers} />}
    </div>
  );
}

function CreateRouteDialog({
  onClose,
  warehouses,
  drivers,
}: {
  onClose: () => void;
  warehouses: ReturnType<typeof useWarehouses>;
  drivers: ReturnType<typeof useDrivers>;
}) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [driverId, setDriverId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!origin || !destination) return toast.error("Origin and destination required");
    if (origin === destination) return toast.error("Origin and destination must differ");
    setSaving(true);
    const payload = {
      origin_warehouse_id: origin,
      destination_warehouse_id: destination,
      assigned_driver_id: driverId || null,
      status: (driverId ? "ASSIGNED" : "PENDING") as never,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    };
    const { error } = await supabase.from("jobs").insert(payload as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Route created");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Create route</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Origin warehouse">
            <select required value={origin} onChange={(e) => setOrigin(e.target.value)} className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm">
              <option value="">Select origin…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </Field>
          <Field label="Destination warehouse">
            <select required value={destination} onChange={(e) => setDestination(e.target.value)} className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm">
              <option value="">Select destination…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </Field>
          <Field label="Driver (optional)">
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm">
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Scheduled (optional)">
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-surface-2/30">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs hover:bg-surface-2">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Creating…" : "Create route"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">{label}</span>
      {children}
    </label>
  );
}
