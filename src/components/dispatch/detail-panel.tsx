import { memo, useEffect, useMemo, useRef } from "react";
import { ArrowRight, Clock, MapPin, Pencil } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { isJobScheduledFuture } from "@/lib/effective-status";
import { computeStopSchedule, etaMinutes, haversineKm, stopDwellMinutes } from "@/lib/geo";
import type { Compliance } from "@/lib/compliance";
import type { Driver, Job, Warehouse } from "@/lib/types";
import type { Stop } from "@/lib/dispatch/use-job-stops";
import type { Lookups } from "@/lib/dispatch/lookups";
import type { PlannedAssign } from "@/lib/planner";
import { ComplianceDot, DriverPicker, PlannedChip, StatusPill } from "./pickers";

export const JobDetailPanel = memo(function JobDetailPanel({
  job, stops, warehouses, drivers, compliance, lookups, planned,
  onAssignDriver, onSetStatus, onEdit,
}: {
  job: Job;
  stops: Stop[];
  warehouses: Warehouse[];
  drivers: Driver[];
  compliance: Record<string, Compliance>;
  lookups: Lookups;
  planned: PlannedAssign | null;
  onAssignDriver: (id: string) => void;
  onSetStatus: (s: string, opts?: { silent?: boolean }) => void;
  onEdit: () => void;
}) {
  const isMR = stops.length > 2;
  const driver = job.assigned_driver_id ? lookups.driversById.get(job.assigned_driver_id) : null;
  const origin = stops[0] ? lookups.warehousesById.get(stops[0].warehouse_id) : null;

  const effectiveStatus = useMemo(() => {
    return isJobScheduledFuture(
      {
        ...job,
        stops: stops.map((s, idx) => ({
          seq: idx, kind: s.kind, warehouse_id: s.warehouse_id,
          scheduled_at: s.scheduled_at, arrived_at: s.arrived_at ?? null,
        })),
      },
      Date.now(),
    ) ? "SCHEDULED" : job.status;
  }, [job, stops]);

  // Use planned_start_at in preference (actual driver departure after planning),
  // falling back to scheduled_at (raw original schedule). This ensures the
  // computed stop-arrival times match what the planner committed to the DB.
  const stopTimes = useMemo(
    () => {
      const basis = job.planned_start_at ?? job.scheduled_at;
      return basis
        ? computeStopSchedule(stops, basis, warehouses)
        : stops.map((s) => s.scheduled_at);
    },
    [job.planned_start_at, job.scheduled_at, stops, warehouses],
  );

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
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 3);
  }, [driver, isLaneAssigned, drivers, origin]);

  // Only run auto-validation and status transitions for assigned/active jobs,
  // never for PENDING runs — timestamps must not appear on unassigned jobs.
  useAutoValidateArrivals(job, stops, stopTimes, driver?.last_update_time ?? null);
  useAutoStatusTransition(job, stops, onSetStatus);
  useAutoComplete(job, stops, onSetStatus);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="font-mono text-xs text-muted-foreground">{job.reference}</div>
            <StatusPill status={effectiveStatus} onChange={onSetStatus} />
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
                const wh = lookups.warehousesById.get(s.warehouse_id);
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
              const wh = lookups.warehousesById.get(s.warehouse_id);
              return `${s.kind === "PICKUP" ? "📦" : "🏁"} ${wh?.name ?? "?"}`;
            }).join(" → ")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ViewOnMapButton job={job} />
          {effectiveStatus !== "COMPLETED" && (
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-2"
            >
              <Pencil className="size-3" /> Edit route
            </button>
          )}
        </div>
      </div>

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
              lookups.driversById.get(planned?.driverId ?? job.planned_driver_id ?? "")?.name ?? "?"
            }
            sequence={planned?.sequence ?? job.planned_sequence ?? undefined}
            startAt={planned?.startAt ?? job.planned_start_at ?? undefined}
            distanceKm={planned?.distKm}
            dailyHoursLeft={planned?.dailyHoursLeft}
          />
        )}
      </div>

      {!isLaneAssigned && !driver && ranked.length > 0 && (
        <>
          <div className="mt-6 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Suggested drivers (3 closest)
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
                {ranked.map(({ driver: d, distKm, eta }, i) => {
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
      )}

      <div className="mt-6">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Stops · {stops.length}
        </div>
        {stops.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No stops on this route yet.
          </div>
        ) : (
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
              const wh = lookups.warehousesById.get(s.warehouse_id);
              const isAssignedOrActive = job.status !== "PENDING";
              // Planned arrival/departure come from the CSV-imported schedule and
              // are shown for every status (including PENDING) so dispatch can see
              // the timings before a driver is assigned.
              const arr = s.scheduled_at ?? stopTimes[idx];
              const dep = arr
                ? new Date(new Date(arr).getTime() + stopDwellMinutes(s.kind) * 60_000).toISOString()
                : null;
              const fmt = (iso: string | null | undefined) =>
                iso
                  ? new Date(iso).toLocaleString(undefined, {
                      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
                    })
                  : "—";
              const delayMin = s.arrived_at && arr
                ? Math.round((new Date(s.arrived_at).getTime() - new Date(arr).getTime()) / 60_000)
                : null;
              const isDelayed = delayMin != null && delayMin > 5;

              // GPS badge: show only when the driver physically arrived via GPS.
              // GPS arrivals write the current real timestamp (≠ planned time).
              // The timestamp-fallback writes arrived_at = planned exactly.
              // So: GPS is confirmed when arrived_at exists AND differs from planned time.
              const isGpsConfirmed = !!(
                s.arrived_at &&
                arr &&
                s.arrived_at !== arr
              );

              return (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] border-t border-border items-center"
                >
                  <div className="col-span-1 font-mono text-muted-foreground">{idx + 1}</div>
                  <div className="col-span-3">
                    <div className="font-mono text-xs text-foreground">{wh?.code ?? "?"}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{wh?.name}</div>
                  </div>
                  <div className="col-span-2">
                    <span
                      className={`font-mono text-[10px] uppercase ${
                        s.kind === "PICKUP" ? "text-blue-500" : "text-emerald-600"
                      }`}
                    >
                      {s.kind === "PICKUP" ? "Pickup" : "Drop"}
                    </span>
                  </div>
                  <div className="col-span-3 font-mono text-foreground text-sm">{fmt(arr)}</div>
                  <div className="col-span-2 font-mono text-foreground text-sm">{fmt(dep)}</div>
                  <div className="col-span-1 font-mono">
                    {/* Only show actual arrival time when job is assigned/active */}
                    {isAssignedOrActive && s.arrived_at ? (
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="flex items-center gap-1">
                          <span className={isDelayed ? "text-amber-600" : "text-emerald-600"}>
                            {new Date(s.arrived_at).toLocaleTimeString([], {
                              hour: "2-digit", minute: "2-digit", hour12: false,
                            })}
                          </span>
                          {isGpsConfirmed && (
                            <span className="inline-flex items-center px-1 py-0.5 rounded bg-orange-500/10 border border-orange-500/30 text-[8px] font-bold text-orange-600">GPS</span>
                          )}
                        </div>
                        {isDelayed && <span className="text-[9px] text-amber-600">+{delayMin}m late</span>}
                      </div>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Clock className="size-3" />
        {job.scheduled_at
          ? `Scheduled ${new Date(job.scheduled_at).toLocaleString(undefined, {
              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
            })}`
          : "No scheduled start"}
      </div>
    </div>
  );
});

const autoValidatedStops = new Set<string>();
const autoCompletedJobs = new Set<string>();

function useAutoStatusTransition(
  job: Job,
  stops: Stop[],
  onSetStatus: (s: string, opts?: { silent?: boolean }) => void,
) {
  const onSetStatusRef = useRef(onSetStatus);
  useEffect(() => { onSetStatusRef.current = onSetStatus; }, [onSetStatus]);

  useEffect(() => {
    if (stops.length === 0) return;
    if (job.status === "COMPLETED" || job.status === "CANCELLED") return;

    const firstArrived = stops[0]?.arrived_at;
    const lastArrived = stops[stops.length - 1]?.arrived_at;
    const anyArrived = stops.some((s) => !!s.arrived_at);

    if (lastArrived && (job.status as string) !== "COMPLETED") {
      // Handled by useAutoComplete
      return;
    }

    if (anyArrived && job.status === "ASSIGNED") {
      // Any arrival means it's no longer just "Assigned"
      onSetStatusRef.current("IN_PROGRESS", { silent: true });
    }
  }, [job.id, job.status, stops]);
}

function useAutoValidateArrivals(
  job: Job,
  stops: Stop[],
  stopTimes: (string | null)[],
  lastDriverUpdateIso: string | null,
) {
  useEffect(() => {
    if (stops.length === 0) return;
    // Never auto-validate arrivals for PENDING jobs — timestamps must only
    // appear once a driver has been assigned and physically arrives.
    if (job.status === "PENDING") return;
    if (job.status === "COMPLETED" || job.status === "CANCELLED") return;

    const STALE_MIN = 15;
    const GRACE_MIN = 20;
    const now = Date.now();
    const lastGps = lastDriverUpdateIso ? new Date(lastDriverUpdateIso).getTime() : 0;
    const gpsStale = !lastGps || (now - lastGps) / 60_000 > STALE_MIN;

    type Update = { id: string; planned: string };
    const updates: Update[] = [];
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      if (!s.id || s.arrived_at) continue;
      const planned = stopTimes[i];
      if (!planned) continue;
      const plannedMs = new Date(planned).getTime();
      if (plannedMs > now) continue;
      const graceElapsed = (now - plannedMs) / 60_000 >= GRACE_MIN;
      if (!gpsStale && !graceElapsed) continue;
      if (autoValidatedStops.has(s.id)) continue;
      autoValidatedStops.add(s.id);
      updates.push({ id: s.id, planned });
    }

    if (updates.length === 0) return;

    void Promise.all(
      updates.map((u) =>
        supabase
          .from("job_stops")
          .update({ arrived_at: u.planned })
          .eq("id", u.id)
          .is("arrived_at", null)
          .then(({ error }) => { if (error) autoValidatedStops.delete(u.id); }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.status, stops, stopTimes, lastDriverUpdateIso]);
}

function useAutoComplete(job: Job, stops: Stop[], onSetStatus: (s: string, opts?: { silent?: boolean }) => void) {
  const onSetStatusRef = useRef(onSetStatus);
  useEffect(() => { onSetStatusRef.current = onSetStatus; }, [onSetStatus]);

  useEffect(() => {
    if (stops.length === 0) return;
    if (job.status === "COMPLETED" || job.status === "CANCELLED") return;
    if (autoCompletedJobs.has(job.id)) return;
    if (!stops.every((s) => !!s.arrived_at)) return;

    const anyDelayed = stops.some((s) => {
      const planned = s.scheduled_at;
      if (!planned || !s.arrived_at) return false;
      return (new Date(s.arrived_at).getTime() - new Date(planned).getTime()) / 60_000 > 5;
    });
    if (anyDelayed) return;

    autoCompletedJobs.add(job.id);
    onSetStatusRef.current("COMPLETED", { silent: true });
  }, [job.id, job.status, stops]);
}

function ViewOnMapButton({ job }: { job: Job }) {
  const navigate = useNavigate();
  const driverId = job.assigned_driver_id ?? job.planned_driver_id ?? null;
  const disabled = !driverId;
  return (
    <button
      onClick={() => {
        if (disabled) return;
        navigate({ to: "/", search: { focusJob: job.id } as never });
      }}
      disabled={disabled}
      title={disabled ? "Assign or plan a driver to view route on map" : "View this route on the live map"}
      className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/15 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <MapPin className="size-3" /> View on map
    </button>
  );
}
