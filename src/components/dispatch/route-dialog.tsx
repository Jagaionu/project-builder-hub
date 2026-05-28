import { useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { computeStopSchedule } from "@/lib/geo";
import { getTenantId } from "@/lib/tenant-insert";
import type { Warehouse } from "@/lib/types";
import type { Stop } from "@/lib/dispatch/use-job-stops";

export default function RouteDialog({
  mode, jobId, initial, onClose, warehouses,
}: {
  mode: "create" | "edit";
  jobId?: string;
  initial?: { scheduled_at: string | null; stops: Stop[] };
  onClose: () => void;
  warehouses: Warehouse[];
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (stops.length < 2) return toast.error("Need at least 2 stops");
    if (stops.some((s) => !s.warehouse_id)) return toast.error("Every stop needs a warehouse");
    setSaving(true);

    try {
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
        const { data, error } = await supabase
          .from("jobs")
          .insert(jobPayload as never)
          .select("id")
          .single();
        if (error) {
          console.error("[jobs.insert]", error);
          toast.error(`Job create failed: ${error.message}`);
          return;
        }
        targetJobId = (data as { id: string }).id;
      } else {
        // Clear stale planning fields so the planner starts fresh after a route
        // change — otherwise planned_driver_id / sequence remain from the old lane.
        const editPayload = {
          ...jobPayload,
          planned_driver_id: null,
          planned_sequence: null,
          planned_start_at: null,
        };
        const { error } = await supabase.from("jobs").update(editPayload as never).eq("id", targetJobId!);
        if (error) {
          console.error("[jobs.update]", error);
          toast.error(`Job update failed: ${error.message}`);
          return;
        }
      }

      const { error: delErr } = await supabase.from("job_stops").delete().eq("job_id", targetJobId!);
      if (delErr) {
        console.error("[stops.delete]", delErr);
        toast.error(`Clear stops failed: ${delErr.message}`);
        return;
      }

      const rows = stops.map((s, i) => ({
        job_id: targetJobId!,
        seq: i,
        kind: s.kind as never,
        warehouse_id: s.warehouse_id,
        scheduled_at:
          i === 0 ? (s.scheduled_at ?? autoTimes[i] ?? null) : (autoTimes[i] ?? null),
      }));
      const { error: stopErr } = await supabase.from("job_stops").insert(rows as never);
      if (stopErr) {
        console.error("[stops.insert]", stopErr, rows);
        toast.error(`Stops insert failed: ${stopErr.message}`);
        return;
      }

      const firstArrival = rows.map((r) => r.scheduled_at).find((s) => !!s) as string | undefined;
      const firstDate = firstArrival ? firstArrival.slice(0, 10) : null;
      const tomorrow = (() => {
        const t = new Date();
        t.setUTCDate(t.getUTCDate() + 1);
        return t.toISOString().slice(0, 10);
      })();
      if (firstDate === tomorrow) {
        toast.success("Route scheduled for tomorrow — click Plan Tomorrow to assign a driver");
      } else {
        toast.success(mode === "create" ? "Route created" : "Route updated");
      }
      onClose();
    } catch (err) {
      console.error("[route-dialog] submit error", err);
      toast.error(err instanceof Error ? err.message : "Save failed — please try again");
    } finally {
      setSaving(false);
    }
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
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
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Stops
              </span>
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
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-col items-end">
                      {i === 0 ? (
                        <input
                          type="datetime-local"
                          required
                          value={s.scheduled_at ? toLocalInput(s.scheduled_at) : ""}
                          onChange={(e) =>
                            update(i, {
                              scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                            })
                          }
                          className="bg-surface border border-border rounded px-2 py-1 text-xs"
                          title="Pickup time — subsequent stops are auto-calculated from this"
                        />
                      ) : (
                        <>
                          <span className="text-xs font-mono text-muted-foreground italic px-2 py-1">
                            {auto
                              ? new Date(auto).toLocaleString(undefined, {
                                  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                                })
                              : "—"}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground/70 mt-0.5">auto</span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="p-1 hover:bg-surface-2 rounded disabled:opacity-30"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === stops.length - 1}
                      className="p-1 hover:bg-surface-2 rounded disabled:opacity-30"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStop(i)}
                      disabled={stops.length <= 2}
                      className="p-1 hover:bg-destructive/20 rounded disabled:opacity-30"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex justify-between gap-2 px-5 py-3 border-t border-border bg-surface-2/30">
          <div>
            {mode === "edit" && (
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 text-destructive px-3 py-1.5 text-xs hover:bg-destructive/20 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" /> {deleting ? "Deleting…" : "Delete lane"}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
