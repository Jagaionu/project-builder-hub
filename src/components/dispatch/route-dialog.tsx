"use client";

import { useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Trash2, Copy, RefreshCw, Clock, Package } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { computeStopSchedule } from "@/lib/geo";
import { getTenantId } from "@/lib/tenant-insert";
import type { Warehouse } from "@/lib/types";
import type { Stop } from "@/lib/dispatch/use-job-stops";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RouteDialog({
  mode, jobId, initial, onClose, warehouses,
}: {
  mode: "create" | "edit";
  jobId?: string;
  initial?: { scheduled_at: string | null; stops: Stop[] };
  onClose: () => void;
  warehouses: Warehouse[];
}) {
  const [vrid, setVrid] = useState<string>("");
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
  const [open, setOpen] = useState(true);

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

  function duplicateStop(i: number) {
    const stop = stops[i];
    if (!stop) return;
    setStops((prev) => {
      const copy = [...prev];
      copy.splice(i + 1, 0, { ...stop, scheduled_at: null });
      return copy;
    });
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
      const jobPayload: Record<string, unknown> = {
        scheduled_at: jobStartIso,
        origin_warehouse_id: stops[0].warehouse_id,
        destination_warehouse_id: stops[stops.length - 1].warehouse_id,
        tenant_id,
      };

      // Add reference only if provided (otherwise DB auto-generates)
      if (vrid.trim()) {
        jobPayload.reference = vrid.trim();
      }

      let targetJobId = jobId;
      if (mode === "create") {
        const { data, error } = await supabase
          .from("jobs")
          .insert(jobPayload as never)
          .select("id,reference")
          .single();
        if (error) {
          console.error("[jobs.insert]", error);
          toast.error(`Job create failed: ${error.message}`);
          return;
        }
        const jobData = data as { id: string; reference: string };
        targetJobId = jobData.id;
        // Show the auto-generated reference if one was created
        if (!vrid.trim()) {
          toast.info(`Created with ID: ${jobData.reference}`);
        }
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
      setOpen(false);
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
    setOpen(false);
    onClose();
  }

  const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        setOpen(false);
        onClose();
      }
    }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create Route" : "Edit Route"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Set up a new delivery route with pickup and drop-off stops"
              : "Modify the route and stops. Changes will reset any planned assignments."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0 gap-4">
          {/* VRID / Reference Field */}
          {mode === "create" && (
            <div className="space-y-2 px-6">
              <Label htmlFor="vrid" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Job ID / VRID
              </Label>
              <div className="flex gap-2">
                <Input
                  id="vrid"
                  placeholder="Leave blank to auto-generate"
                  value={vrid}
                  onChange={(e) => setVrid(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setVrid("")}
                  title="Clear to auto-generate"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                If left blank, a unique ID will be generated automatically.
              </p>
            </div>
          )}

          {/* Stops Section */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-6">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Stops · {stops.length}
              </Label>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addStop("PICKUP")}
                  className="text-xs"
                >
                  <Package className="size-3.5" /> Pickup
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addStop("DROP")}
                  className="text-xs"
                >
                  <Package className="size-3.5" /> Drop
                </Button>
              </div>
            </div>

            {/* Stops List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-2">
              {stops.map((s, i) => {
                const auto = computedTimes[i];
                const wh = warehouseMap.get(s.warehouse_id);
                const isFirst = i === 0;
                const isLast = i === stops.length - 1;

                return (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-surface/50 p-3.5 space-y-3 hover:border-border/80 transition-colors"
                  >
                    {/* Stop Header */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary text-xs font-bold">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <select
                          value={s.kind}
                          onChange={(e) => update(i, { kind: e.target.value as "PICKUP" | "DROP" })}
                          className="text-sm font-medium px-2 py-1 rounded border border-border/50 bg-background hover:border-border transition-colors"
                        >
                          <option value="PICKUP">📦 Pickup</option>
                          <option value="DROP">🏁 Drop-off</option>
                        </select>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => move(i, -1)}
                          disabled={isFirst}
                          title="Move up"
                        >
                          <ChevronUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => move(i, 1)}
                          disabled={isLast}
                          title="Move down"
                        >
                          <ChevronDown className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => duplicateStop(i)}
                          title="Duplicate this stop"
                        >
                          <Copy className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeStop(i)}
                          disabled={stops.length <= 2}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="Delete stop"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Warehouse Selection */}
                    <div>
                      <Label htmlFor={`warehouse-${i}`} className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                        Warehouse
                      </Label>
                      <select
                        id={`warehouse-${i}`}
                        required
                        value={s.warehouse_id}
                        onChange={(e) => update(i, { warehouse_id: e.target.value })}
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
                      >
                        <option value="">Select a warehouse…</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.code} — {w.name}
                          </option>
                        ))}
                      </select>
                      {wh && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          📍 {wh.address || "No address"}
                        </p>
                      )}
                    </div>

                    {/* Time Selection */}
                    <div>
                      <Label htmlFor={`time-${i}`} className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                        {isFirst ? "Pickup Time" : "Estimated Arrival"}
                      </Label>
                      {isFirst ? (
                        <div className="flex gap-2">
                          <input
                            id={`time-${i}`}
                            type="datetime-local"
                            required
                            value={s.scheduled_at ? toLocalInput(s.scheduled_at) : ""}
                            onChange={(e) =>
                              update(i, {
                                scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                              })
                            }
                            className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
                            title="Pickup time — subsequent stops are auto-calculated from this"
                          />
                        </div>
                      ) : (
                        <div className="px-3 py-2 rounded-md border border-border/50 bg-muted/30 text-sm font-mono text-foreground flex items-center gap-2">
                          <Clock className="size-4 text-muted-foreground" />
                          {auto
                            ? new Date(auto).toLocaleString(undefined, {
                                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                              })
                            : "—"}
                          <span className="ml-auto text-[10px] text-muted-foreground">auto</span>
                        </div>
                      )}
                      {!isFirst && auto && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Automatically calculated based on distance, traffic, and dwell time.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/20">
            <div className="flex items-center justify-between w-full">
              <div>
                {mode === "edit" && (
                  <Button
                    type="button"
                    onClick={onDelete}
                    disabled={deleting}
                    variant="destructive"
                    size="sm"
                  >
                    <Trash2 className="size-3.5" />
                    {deleting ? "Deleting…" : "Delete Route"}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    onClose();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Saving…" : mode === "create" ? "Create Route" : "Save Changes"}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
