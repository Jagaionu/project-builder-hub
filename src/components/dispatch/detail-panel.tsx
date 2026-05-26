import { memo, useEffect, useMemo, useRef } from "react";
import { ArrowRight, Clock, MapPin, Pencil, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Driver, Job, Warehouse } from "@/lib/types";
import type { Compliance } from "@/lib/compliance";
import { computeStopSchedule, etaMinutes, haversineKm, stopDwellMinutes } from "@/lib/geo";
import { isJobScheduledFuture } from "@/lib/effective-status";
import { STATUS_CONFIG, type EffectiveStatus } from "@/lib/dispatch/status";
import type { Lookups } from "@/lib/dispatch/lookups";
import type { Stop } from "@/lib/dispatch/use-job-stops";
import { ComplianceDot, DriverPicker, PlannedChip, StatusPill } from "./pickers";
import { cn } from "@/lib/utils";

export interface JobDetailPanelProps {
  job: Job;
  stops: Stop[];
  warehouses: Warehouse[];
  drivers: Driver[];
  lookups: Lookups;
  compliance: Record<string, Compliance>;
  planned: { driverId: string; sequence: number; startAt: string; distKm: number; dailyHoursLeft: number } | null;
  onAssignDriver: (id: string) => void;
  onSetStatus: (s: string, opts?: { silent?: boolean }) => void;
  onEdit: () => void;
}

export const JobDetailPanel = memo(function JobDetailPanel({
  job, stops, warehouses, drivers, lookups, compliance, planned,
  onAssignDriver, onSetStatus, onEdit,
}: JobDetailPanelProps) {
  const { warehousesById, driversById } = lookups;
  const origin = warehousesById.get(stops[0]?.warehouse_id ?? "");
  const isMR = stops.length > 2;
  const driver = job.assigned_driver_id ? driversById.get(job.assigned_driver_id) : undefined;

  const effectiveStatus: EffectiveStatus = useMemo(() => {
    const future = isJobScheduledFuture(
      {
        ...job,
        stops: stops.map((s, idx) => ({
          seq: idx, kind: s.kind, warehouse_id: s.warehouse_id,
          scheduled_at: s.scheduled_at, arrived_at: s.arrived_at ?? null,
        })),
      },
      Date.now(),
    );
    return future ? "SCHEDULED" : (job.status as EffectiveStatus);
  }, [job, stops]);

  const stopTimes = useMemo(
    () => job.scheduled_at
      ? computeStopSchedule(stops, job.scheduled_at, warehouses)
      : stops.map((s) => s.scheduled_at),
    [stops, job.scheduled_at, warehouses],
  );

  // Suggested drivers — only when truly unassigned.
  const isLaneAssigned = !!job.assigned_driver_id || job.status === "ASSIGNED";
  const ranked = useMemo(() => {
    if (driver || isLaneAssigned || !origin) return [];
    return drivers
      .filter((d) => d.status === "AVAILABLE" || d.status === "ON_SHIFT")
      .filter((d) => d.current_lat != null && d.current_lon != null)
      .map((d) => {
        const distKm = haversineKm(d.current_lat!, d.current_lon!, origin.latitude, origin.longitude);
        return { driver: d, distKm, eta: etaMinutes(distKm) };
      })
      .sort((a, b) => a.distKm - b.distKm);
  }, [driver, isLaneAssigned, drivers, origin]);

  // Auto-validate arrivals (GPS fallback).
  useAutoValidateArrivals(job, stops, stopTimes, driver?.last_update_time ?? null);

  // Auto-complete when all arrived & no significant delays.
  useAutoComplete(job, stops, onSetStatus);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="font-mono text-xs text-muted-foreground">{job.reference}</div>
            <StatusPill status={effectiveStatus} onChange={(s) => onSetStatus(s)} />
            {isMR && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] border border-amber-500/30 text-amber-600 bg-amber-500/5">
                MR · {stops.length} stops
              </span>
            )}
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
            {stops.length === 0 ? (
              <span className="text-muted-foreground">No stops</span>
            ) : (
              stops.map((s, i) => {
                const wh = warehousesById.get(s.warehouse_id);
                return (
                  <span key={i} className="flex items-center gap-2">
                    <span className={s.kind === "PICKUP" ? "text-blue-500" : "text-emerald-600"}>
                      {wh?.code ?? "?"}
                    </span>
                    {i < stops.length - 1 && <ArrowRight className="size-4 text-muted-foreground" />}
                  </span>
                );
              })
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {stops.map((s) => {
              const wh = warehousesById.get(s.warehouse_id);
              return `${s.kind === "PICKUP" ? "📦" : "🏁"} ${wh?.name ?? "?"}`;
            }).join(" → ")}
          </p>
        </div>
        {effectiveStatus !== "COMPLETED" && (
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-2"
          >
            <Pencil className="size-3" /> Edit route
          </button>
        )}
      </div>

      {/* Assigned driver */}
      <div className="mt-5 rounded-lg border border-border bg-surface p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Assigned driver
        </div>
        <DriverPicker
          driverId={job.assigned_driver_id}
          drivers={drivers}
          compliance={compliance}
          onChange={onAssignDriver}
        />
        {!driver && (planned || job.planned_driver_id) && (
          <PlannedChip
            driverName={
              driversById.get(planned?.driverId ?? job.planned_driver_id ?? "")?.name ?? "?"
            }
            sequence={planned?.sequence ?? job.planned_sequence ?? undefined}
            startAt={planned?.startAt ?? job.planned_start_at ?? undefined}
            distanceKm={planned?.distKm}
            dailyHoursLeft={planned?.dailyHoursLeft}
          />
        )}
      </div>

      {/* Suggested */}
      {!isLaneAssigned && !driver && ranked.length > 0 && (
        <SuggestedDriversTable
          ranked={ranked}
          compliance={compliance}
          onAssignDriver={onAssignDriver}
        />
      )}

      {/* Stops */}
      <div className="mt-6">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Stops · {stops.length}
        </div>
        {stops.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No stops on this route yet.
          </div>
        ) : (
          <StopsTable stops={stops} stopTimes={stopTimes} warehousesById={warehousesById} />
        )}
      </div>

      <div className="mt-4 text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Clock className="size-3" />
        {job.scheduled_at
          ? `Scheduled ${new Date(job.scheduled_at).toLocaleString()}`
          : "No scheduled start"}
      </div>
    </div>
  );
});

// ── Sub-tables ───────────────────────────────────────────────────────────────

function SuggestedDriversTable({
  ranked, compliance, onAssignDriver,
}: {
  ranked: { driver: Driver; distKm: number; eta: number }[];
  compliance: Record<string, Compliance>;
  onAssignDriver: (id: string) => void;
}) {
  return (
    <>
      <div className="mt-6 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
        <Sparkles className="size-3.5 text-accent" /> Suggested drivers (3 closest)
      </div>
      <div className="mt-3 rounded-md border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Driver</th>
              <th className="px-3 py-2 text-right">Distance</th>
              <th className="px-3 py-2 text-right">ETA</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ranked.slice(0, 3).map(({ driver: d, distKm, eta }, i) => {
              const dc = compliance[d.id];
              const blocked = !!dc?.blockAssignment;
              return (
                <tr key={d.id} className={i === 0 ? "bg-primary/5" : ""}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {i === 0 && (
                        <span className="text-[9px] font-mono text-primary border border-primary/40 rounded px-1">
                          BEST
                        </span>
                      )}
                      <span>{d.name}</span>
                      {dc && <ComplianceDot c={dc} driverStatus={d.status} />}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{distKm.toFixed(1)} km</td>
                  <td className="px-3 py-2.5 text-right font-mono">{eta} min</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => onAssignDriver(d.id)}
                      disabled={blocked}
                      title={blocked ? dc?.issues.find((i) => i.level === "breach")?.msg : undefined}
                      className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Assign
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StopsTable({
  stops, stopTimes, warehousesById,
}: {
  stops: Stop[];
  stopTimes: Array<string | null>;
  warehousesById: Map<string, Warehouse>;
}) {
  const fmt = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(undefined, {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    }) : "—";

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        <div className="col-span-1">#</div>
        <div className="col-span-3">Stop</div>
        <div className="col-span-2">Kind</div>
        <div className="col-span-3">Planned arrival</div>
        <div className="col-span-2">Planned departure</div>
        <div className="col-span-1">Actual</div>
      </div>
      {stops.map((s, idx) => {
        const wh = warehousesById.get(s.warehouse_id);
        const arr = s.scheduled_at ?? stopTimes[idx];
        const dep = arr
          ? new Date(new Date(arr).getTime() + stopDwellMinutes(s.kind) * 60_000).toISOString()
          : null;
        const delayMin = s.arrived_at && arr
          ? Math.round((new Date(s.arrived_at).getTime() - new Date(arr).getTime()) / 60_000)
          : null;
        const isDelayed = delayMin != null && delayMin > 5;
        return (
          <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] border-t border-border items-center">
            <div className="col-span-1 font-mono text-muted-foreground">{idx + 1}</div>
            <div className="col-span-3">
              <div className="font-mono text-xs text-foreground">{wh?.code ?? "?"}</div>
              <div className="text-[10px] text-muted-foreground truncate">{wh?.name}</div>
            </div>
            <div className="col-span-2">
              <span className={cn(
                "font-mono text-[10px] uppercase",
                s.kind === "PICKUP" ? "text-blue-500" : "text-emerald-600",
              )}>
                {s.kind === "PICKUP" ? "Pickup" : "Drop"}
              </span>
            </div>
            <div className="col-span-3 font-mono text-foreground text-sm">{fmt(arr)}</div>
            <div className="col-span-2 font-mono text-foreground text-sm">{fmt(dep)}</div>
            <div className="col-span-1 font-mono">
              {s.arrived_at ? (
                <div className="flex flex-col items-start">
                  <span className={isDelayed ? "text-amber-600" : "text-emerald-600"}>
                    {new Date(s.arrived_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {isDelayed && (
                    <span className="text-[9px] text-amber-600">+{delayMin}m late</span>
                  )}
                </div>
              ) : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Side-effects ─────────────────────────────────────────────────────────────

/**
 * Auto-validate arrivals: when a planned arrival has passed AND either GPS is
 * stale or grace period has elapsed, stamp arrived_at so the route can
 * progress without manual intervention. Batches all writes for the current
 * job in parallel.
 */
function useAutoValidateArrivals(
  job: Job,
  stops: Stop[],
  stopTimes: Array<string | null>,
  driverLastUpdate: string | null,
) {
  const validatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (stops.length === 0) return;
    if (job.status === "COMPLETED" || job.status === "CANCELLED") return;
    const STALE_MIN = 15;
    const GRACE_MIN = 20;
    const now = Date.now();
    const lastGps = driverLastUpdate ? new Date(driverLastUpdate).getTime() : 0;
    const gpsStale = !lastGps || (now - lastGps) / 60_000 > STALE_MIN;

    const writes: Array<Promise<unknown>> = [];
    stops.forEach((s, i) => {
      if (!s.id || s.arrived_at) return;
      const planned = stopTimes[i];
      if (!planned) return;
      const plannedMs = new Date(planned).getTime();
      if (plannedMs > now) return;
      const graceElapsed = (now - plannedMs) / 60_000 >= GRACE_MIN;
      if (!gpsStale && !graceElapsed) return;
      if (validatedRef.current.has(s.id)) return;
      validatedRef.current.add(s.id);
      writes.push(
        supabase
          .from("job_stops")
          .update({ arrived_at: planned } as never)
          .eq("id", s.id)
          .is("arrived_at", null)
          .then(({ error }) => {
            if (error && s.id) validatedRef.current.delete(s.id);
          }),
      );
    });
    void Promise.all(writes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.status, stops, stopTimes, driverLastUpdate]);
}

function useAutoComplete(
  job: Job,
  stops: Stop[],
  onSetStatus: (s: string, opts?: { silent?: boolean }) => void,
) {
  const completedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (stops.length === 0) return;
    if (job.status === "COMPLETED" || job.status === "CANCELLED") return;
    if (completedRef.current.has(job.id)) return;
    const allArrived = stops.every((s) => !!s.arrived_at);
    if (!allArrived) return;
    const anyDelayed = stops.some((s) => {
      const planned = s.scheduled_at;
      if (!planned || !s.arrived_at) return false;
      const delayMin = (new Date(s.arrived_at).getTime() - new Date(planned).getTime()) / 60_000;
      return delayMin > 5;
    });
    if (anyDelayed) return;
    completedRef.current.add(job.id);
    onSetStatus("COMPLETED", { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.status, stops]);
}
