import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Ban,
  Check,
  Clock,
  Copy,
  CopyPlus,
  HelpCircle,
  MapPin,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { isJobScheduledFuture } from "@/lib/effective-status";
import {
  computeStopSchedule,
  etaMinutes,
  haversineKm,
  stopDwellMinutes,
  stopCriticalWindow,
  transitTimeHours,
} from "@/lib/geo";
import { isDriverAvailableOnDate } from "@/lib/planner";
import type { Compliance } from "@/lib/compliance";
import type { Driver, DriverShift, DriverAvailabilityOverride, Job, Warehouse } from "@/lib/types";
import type { Stop } from "@/lib/dispatch/use-job-stops";
import type { Lookups } from "@/lib/dispatch/lookups";
import type { PlannedAssign } from "@/lib/planner";
import { ComplianceDot, DriverPicker, PlannedChip, StatusPill } from "./pickers";
import { RouteNotesButton } from "./route-notes";
import { useDriverEquipment } from "@/lib/use-driver-equipment";

const VRID_AUDIT_LABEL: Record<string, string> = {
  "lane.create": "Lane created",
  "lane.upload": "Lanes uploaded",
  "plan.run": "Planner run",
  "job.cancel": "Route cancelled",
  "job.assign": "Driver assigned",
  "job.status": "Status changed",
  "job.clone": "Route cloned",
  "lane.edit": "Lane edited",
  "note.add": "Note added",
  "job.delete": "Job deleted",
  "import.delete": "Import deleted",
};

type AuditRow = {
  id: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  created_at: string;
};

// Clickable VRID → per-job audit trail (Login | Event Date | Action), regardless
// of the job's status. Reads the 14-day activity_log for this job's entity_id.
function VridAuditButton({ jobId, reference }: { jobId: string; reference: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    const sb = supabase as unknown as { from: (t: string) => any };
    sb.from("activity_log")
      .select("id, actor_name, actor_email, action, created_at")
      .eq("entity_type", "job")
      .eq("entity_id", jobId)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: AuditRow[] | null }) => {
        setRows(data ?? []);
        setLoaded(true);
      });
  }, [open, loaded, jobId]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View audit trail"
        className="font-mono text-xs text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
      >
        {reference}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-lg p-5 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-0.5">
              <h3 className="text-sm font-semibold">Audit · {reference}</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Activity for this lane (last 14 days)
            </p>
            <div className="flex-1 overflow-auto">
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  {loaded ? "No audit events for this lane." : "Loading…"}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4">Login</th>
                      <th className="py-2 pr-4">Event Date</th>
                      <th className="py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/50">
                        <td className="py-2 pr-4">{r.actor_name ?? r.actor_email ?? "—"}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString(undefined, {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </td>
                        <td className="py-2">{VRID_AUDIT_LABEL[r.action] ?? r.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// A live GPS ETA only shows within this many minutes of the planned yard time
// (or once the driver is actually en route). Before that, an "if he left now"
// estimate is misleading because the driver may take another job first.
const ETA_LEAD_MIN = 60;
const ETA_LEAD_MS = ETA_LEAD_MIN * 60_000;
const ESTIMATED_HELP =
  "Live arrival estimate from the driver location via GPS. It only appears within " +
  ETA_LEAD_MIN +
  " min of the planned yard time, or once the driver is en route; before that it shows the from HH:MM placeholder. It refreshes on each GPS update, so it sharpens as the run nears. Once the driver arrives or departs, it shows the real GPS time (amber if late).";

export const JobDetailPanel = memo(function JobDetailPanel({
  job,
  stops,
  warehouses,
  drivers,
  compliance,
  lookups,
  planned,
  driverShifts,
  shiftOverrides,
  onAssignDriver,
  onSetStatus,
  onEdit,
  onClone,
}: {
  job: Job;
  stops: Stop[];
  warehouses: Warehouse[];
  drivers: Driver[];
  compliance: Record<string, Compliance>;
  lookups: Lookups;
  planned: PlannedAssign | null;
  driverShifts: Record<string, DriverShift>;
  shiftOverrides: DriverAvailabilityOverride[];
  onAssignDriver: (id: string) => void;
  onSetStatus: (s: string, opts?: { silent?: boolean }) => void;
  onEdit: () => void;
  onClone: () => void;
}) {
  const isMR = stops.length > 2;
  const laneString = stops
    .map((s) => lookups.warehousesById.get(s.warehouse_id)?.code ?? "?")
    .join("->");
  const driver = job.assigned_driver_id ? lookups.driversById.get(job.assigned_driver_id) : null;
  const origin = stops[0] ? lookups.warehousesById.get(stops[0].warehouse_id) : null;

  const effectiveStatus = useMemo(() => {
    return isJobScheduledFuture(
      {
        ...job,
        stops: stops.map((s, idx) => ({
          seq: idx,
          kind: s.kind,
          warehouse_id: s.warehouse_id,
          scheduled_at: s.scheduled_at,
          arrived_at: s.arrived_at ?? null,
        })),
      },
      Date.now(),
    )
      ? "SCHEDULED"
      : job.status;
  }, [job, stops]);

  // Anchor planned times to the SCHEDULED run start — the first stop's
  // scheduled time — so the schedule shows even before the planner runs and
  // stays consistent with the driver app. Falls back to job-level start, then
  // to the raw per-stop scheduled times.
  const stopTimes = useMemo(() => {
    const basis = stops[0]?.scheduled_at ?? job.planned_start_at ?? job.scheduled_at;
    return basis
      ? computeStopSchedule(
          stops,
          basis,
          warehouses,
          (job as { handling_minutes?: number | null }).handling_minutes ?? undefined,
        )
      : stops.map((s) => s.scheduled_at);
  }, [job.planned_start_at, job.scheduled_at, stops, warehouses]);
  // First stop not yet arrived — the one we project a live GPS ETA for (dispatcher only).
  const nextUnarrivedIdx = stops.findIndex((s) => !s.arrived_at);

  // Collections where the driver was held longer than the handling window —
  // surfaced so dispatchers can answer "why is the drop late?" at a glance.
  const heldAtCollection = useMemo(() => {
    const handling = (job as { handling_minutes?: number | null }).handling_minutes ?? 20;
    const out: { code: string; overMin: number }[] = [];
    for (const s of stops) {
      if (s.kind !== "PICKUP" || !s.arrived_at || !s.departed_at) continue;
      const dwell = Math.round(
        (new Date(s.departed_at).getTime() - new Date(s.arrived_at).getTime()) / 60_000,
      );
      const over = dwell - handling;
      if (over > 5) {
        const wh = lookups.warehousesById.get(s.warehouse_id);
        out.push({ code: wh?.code ?? "?", overMin: over });
      }
    }
    return out;
  }, [stops, job, lookups]);

  const isLaneAssigned = !!job.assigned_driver_id || job.status === "ASSIGNED";

  const driverEquip = useDriverEquipment();

  const ranked = useMemo(() => {
    if (driver || isLaneAssigned || !origin) return [];
    const targetDate = job.for_date ?? new Date().toISOString().slice(0, 10);
    const jobEquip = (job as { equipment_type?: string | null }).equipment_type ?? null;
    // Inter-stop driving hours for the route; per-driver deadhead added below.
    let interH = 0;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = lookups.warehousesById.get(stops[i].warehouse_id);
      const b = lookups.warehousesById.get(stops[i + 1].warehouse_id);
      if (a && b)
        interH += transitTimeHours(haversineKm(a.latitude, a.longitude, b.latitude, b.longitude));
    }
    return drivers
      .filter((d) => isDriverAvailableOnDate(d.id, targetDate, driverShifts, shiftOverrides))
      .filter((d) => d.current_lat != null && d.current_lon != null)
      .filter((d) => {
        // Equipment must match the job (planner's gate).
        const caps = driverEquip[d.id];
        if (jobEquip && caps && caps.length > 0 && !caps.includes(jobEquip)) return false;
        const dc = compliance[d.id];
        if (dc?.blockAssignment) return false; // already in breach
        // Hours fit: deadhead + inter-stop driving must fit the tightest of
        // daily / weekly / fortnight headroom — never suggest illegal work.
        const deadheadH = transitTimeHours(
          haversineKm(d.current_lat!, d.current_lon!, origin.latitude, origin.longitude),
        );
        if (
          dc &&
          deadheadH + interH > Math.min(dc.dailyHeadroom, dc.weeklyHeadroom, dc.twoWeekHeadroom)
        ) {
          return false;
        }
        return true;
      })
      .map((d) => {
        const distKm = haversineKm(
          d.current_lat!,
          d.current_lon!,
          origin.latitude,
          origin.longitude,
        );
        return { driver: d, distKm, eta: etaMinutes(distKm) };
      })
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 3);
  }, [
    driver,
    isLaneAssigned,
    drivers,
    origin,
    job,
    stops,
    driverShifts,
    shiftOverrides,
    compliance,
    driverEquip,
    lookups,
  ]);

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
            <div className="flex items-center gap-1">
              <VridAuditButton jobId={job.id} reference={job.reference} />
              <CopyButton value={job.reference} title="Copy reference" />
            </div>
            <StatusPill
              status={effectiveStatus}
              onChange={onSetStatus}
              disabled={job.status === "COMPLETED" || job.status === "CANCELLED"}
            />
            {isMR && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] border border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5">
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
                    <span
                      className={
                        s.kind === "PICKUP"
                          ? "text-blue-500 dark:text-blue-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      {wh?.code ?? "?"}
                    </span>
                    {i < stops.length - 1 && (
                      <ArrowRight className="size-4 text-muted-foreground" />
                    )}
                  </span>
                );
              })
            )}
            {stops.length > 0 && <CopyButton value={laneString} title="Copy lane" />}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {stops
              .map((s) => {
                const wh = lookups.warehousesById.get(s.warehouse_id);
                return `${s.kind === "PICKUP" ? "📦" : "🏁"} ${wh?.name ?? "?"}`;
              })
              .join(" → ")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ViewOnMapButton job={job} />
          <RouteNotesButton jobId={job.id} reference={job.reference} />
          <RouteActionsMenu
            effectiveStatus={effectiveStatus}
            onEdit={onEdit}
            onClone={onClone}
            onCancel={() => onSetStatus("CANCELLED")}
          />
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
          disabled={job.status === "COMPLETED" || job.status === "CANCELLED"}
        />
        {(job.status === "COMPLETED" || job.status === "CANCELLED") && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Driver can't be changed on a {job.status === "COMPLETED" ? "completed" : "cancelled"}{" "}
            route.
          </p>
        )}
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

        {/* Return-to-base warning — shown when the assigned/planned driver must
            return to their home warehouse at end of day. The badge is
            informational only; enforcement happens in plan-jobs-core.server.ts. */}
        {(() => {
          const activeDriverId =
            job.assigned_driver_id ?? planned?.driverId ?? job.planned_driver_id ?? null;
          if (!activeDriverId) return null;
          const activeDriver = lookups.driversById.get(activeDriverId);
          if (!activeDriver?.return_to_base_required || !activeDriver?.home_warehouse_id)
            return null;
          const homeWh = lookups.warehousesById.get(activeDriver.home_warehouse_id);

          // Check if the last stop for this job already ends at home warehouse.
          const lastStop = stops.length > 0 ? stops[stops.length - 1] : null;
          const alreadyHome = lastStop?.warehouse_id === activeDriver.home_warehouse_id;
          if (alreadyHome) return null;

          return (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              <RotateCcw size={12} className="shrink-0" />
              <span>
                Driver must return to{" "}
                <span className="font-semibold">{homeWh?.code ?? "home base"}</span> — deadhead leg
                will be added by the planner
              </span>
            </div>
          );
        })()}
      </div>

      {!isLaneAssigned && !driver && ranked.length > 0 && (
        <>
          <div className="mt-6 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Suggested drivers · eligible, closest first
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
                          title={
                            blocked ? dc?.issues.find((i) => i.level === "breach")?.msg : undefined
                          }
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
          <>
            {heldAtCollection.length > 0 && (
              <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <Clock className="size-3.5 shrink-0 mt-0.5" />
                <span>
                  Delayed at collection:{" "}
                  <span className="font-semibold">
                    {heldAtCollection.map((h) => h.code + " +" + h.overMin + "m").join(", ")}
                  </span>{" "}
                  — held past the handling window, which pushes the drop ETA.
                </span>
              </div>
            )}
            <div className="rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <div className="col-span-1">#</div>
              <div className="col-span-3">Stop</div>
              <div className="col-span-3">Planned yard</div>
              <div className="col-span-3">Planned dock</div>
              <div className="col-span-2 flex items-center gap-1">
                Estimated
                <span
                  title={ESTIMATED_HELP}
                  aria-label="How the estimate works"
                  className="inline-flex cursor-help"
                >
                  <HelpCircle className="size-3 text-muted-foreground/60" />
                </span>
              </div>
            </div>
            {stops.map((s, idx) => {
              const wh = lookups.warehousesById.get(s.warehouse_id);
              const isAssignedOrActive = job.status !== "PENDING";
              // The scheduled time is the stop's CRITICAL time — CPT (pull/depart)
              // for a pickup, CIT (inject/arrive) for a drop. Derive the implied
              // arrival + departure so a pickup arrives BEFORE its CPT.
              const plannedRaw = s.scheduled_at ?? stopTimes[idx];
              const win = stopCriticalWindow(
                plannedRaw,
                s.kind,
                (job as { handling_minutes?: number | null }).handling_minutes ?? undefined,
              );
              // Imported (FMC) stops carry an explicit yard departure, and their
              // scheduled_at IS the yard arrival. Created routes compute the yard
              // (CPT − 20 / CIT) and show the critical dock time (CPT/CIT).
              const isImported = s.yard_departure != null;
              const arr = isImported ? plannedRaw : win.arrival; // planned yard arrival
              const dockTime = isImported ? s.yard_departure : plannedRaw; // departure: imported yard / created dock
              // Live estimated arrival for the NEXT un-arrived stop, from the
              // assigned driver's current GPS — only once they've left the
              // previous stop. Dispatcher-only (drivers see real times only).
              let estArrIso: string | null = null;
              let etaFromIso: string | null = null;
              const dLat = driver?.current_lat ?? null;
              const dLon = driver?.current_lon ?? null;
              if (
                idx === nextUnarrivedIdx &&
                isAssignedOrActive &&
                dLat != null &&
                dLon != null &&
                wh
              ) {
                const prev = idx > 0 ? stops[idx - 1] : null;
                const prevWh = prev ? lookups.warehousesById.get(prev.warehouse_id) : null;
                const prevDeparted =
                  idx === 0 ||
                  !!(prev as { departed_at?: string | null } | null)?.departed_at ||
                  (prevWh
                    ? haversineKm(dLat, dLon, prevWh.latitude, prevWh.longitude) * 1000 > 300
                    : true);
                // A live GPS ETA from the driver current position only matters once
                // the run is imminent or the driver is en route; otherwise it is
                // misleading because the driver may take another job first. Show it
                // within ETA_LEAD_MIN of the planned yard arrival, or once under way.
                const plannedArrMs = arr ? new Date(arr).getTime() : null;
                const jobUnderway =
                  job.status === "IN_PROGRESS" ||
                  job.status === "ARRIVED_PICKUP" ||
                  job.status === "EN_ROUTE_DELIVERY";
                const withinLead =
                  plannedArrMs != null && Date.now() >= plannedArrMs - ETA_LEAD_MS;
                if (prevDeparted && (withinLead || jobUnderway)) {
                  const km = haversineKm(dLat, dLon, wh.latitude, wh.longitude);
                  estArrIso = new Date(Date.now() + etaMinutes(km) * 60_000).toISOString();
                } else if (prevDeparted && plannedArrMs != null) {
                  etaFromIso = new Date(plannedArrMs - ETA_LEAD_MS).toISOString();
                }
              }
              const fmt = (iso: string | null | undefined) =>
                iso
                  ? new Date(iso).toLocaleString(undefined, {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  : "—";
              // Lateness: a PICKUP is late only if it DEPARTED (GPS) after its
              // planned departure (CPT / yard departure) — arriving early at the
              // yard is NOT late. A DROP is late if it ARRIVED after its planned
              // arrival (CIT / yard arrival).
              const lateEvent =
                s.kind === "PICKUP" ? (s.departed_at ?? null) : (s.arrived_at ?? null);
              const lateTarget = s.kind === "PICKUP" ? dockTime : arr;
              const delayMin =
                lateEvent && lateTarget
                  ? Math.round(
                      (new Date(lateEvent).getTime() - new Date(lateTarget).getTime()) / 60_000,
                    )
                  : null;
              const isDelayed = delayMin != null && delayMin > 5;

              // GPS time shown in the Estimated column: a pickup's pull (departure)
              // once it happens, else its yard arrival; a drop's arrival.
              const gpsTime =
                s.kind === "PICKUP"
                  ? (s.departed_at ?? s.arrived_at ?? null)
                  : (s.arrived_at ?? null);
              const isGpsConfirmed = !!(s.arrived_at && plannedRaw && s.arrived_at !== plannedRaw);
              const dwellMin =
                s.arrived_at && s.departed_at
                  ? Math.round(
                      (new Date(s.departed_at).getTime() - new Date(s.arrived_at).getTime()) /
                        60_000,
                    )
                  : null;

              return (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] border-t border-border items-center"
                  style={{ background: idx % 2 === 0 ? "var(--surface)" : "var(--background)" }}
                >
                  <div className="col-span-1 font-mono text-muted-foreground">{idx + 1}</div>
                  <div className="col-span-3 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-foreground">{wh?.code ?? "?"}</span>
                      <span
                        className={`font-mono text-[9px] uppercase ${s.kind === "PICKUP" ? "text-blue-500 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400"}`}
                      >
                        {s.kind === "PICKUP" ? "Pick" : "Drop"}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{wh?.name}</div>
                    {dwellMin != null && (
                      <div className="text-[9px] text-muted-foreground/80">on site {dwellMin}m</div>
                    )}
                  </div>
                  <div className="col-span-3 font-mono text-foreground text-sm">{fmt(arr)}</div>
                  <div className="col-span-3 font-mono text-foreground text-sm">
                    {fmt(dockTime)}
                    {!isImported && dockTime && (
                      <span
                        title={
                          s.kind === "PICKUP" ? "Critical Pull Time" : "Critical Injection Time"
                        }
                        className={`ml-1 text-[9px] font-semibold ${s.kind === "PICKUP" ? "text-blue-500 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400"}`}
                      >
                        {s.kind === "PICKUP" ? "CPT" : "CIT"}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 font-mono text-sm">
                    {isAssignedOrActive && gpsTime ? (
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="flex items-center gap-1">
                          <span
                            className={
                              isDelayed
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-emerald-600 dark:text-emerald-400"
                            }
                          >
                            {new Date(gpsTime).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}
                          </span>
                          {isGpsConfirmed && (
                            <span className="inline-flex items-center px-1 py-0.5 rounded bg-orange-500/10 border border-orange-500/30 text-[8px] font-bold text-orange-600 dark:text-orange-400">
                              GPS
                            </span>
                          )}
                        </div>
                        {isDelayed && (
                          <span className="text-[9px] text-amber-600 dark:text-amber-400">
                            +{delayMin}m late
                          </span>
                        )}
                      </div>
                    ) : estArrIso ? (
                      <span className="text-primary">
                        {new Date(estArrIso).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    ) : etaFromIso ? (
                      <span
                        className="text-muted-foreground/70 text-[10px]"
                        title="A live GPS ETA appears closer to the run, once it is accurate"
                      >
                        from{" "}
                        {new Date(etaFromIso).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>

      <div className="mt-4 text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Clock className="size-3" />
        {job.scheduled_at
          ? `Scheduled ${new Date(job.scheduled_at).toLocaleString(undefined, {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
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
  useEffect(() => {
    onSetStatusRef.current = onSetStatus;
  }, [onSetStatus]);

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
          .then(({ error }) => {
            if (error) autoValidatedStops.delete(u.id);
          }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.status, stops, stopTimes, lastDriverUpdateIso]);
}

function useAutoComplete(
  job: Job,
  stops: Stop[],
  onSetStatus: (s: string, opts?: { silent?: boolean }) => void,
) {
  const onSetStatusRef = useRef(onSetStatus);
  useEffect(() => {
    onSetStatusRef.current = onSetStatus;
  }, [onSetStatus]);

  useEffect(() => {
    if (stops.length === 0) return;
    if (job.status === "COMPLETED" || job.status === "CANCELLED") return;
    if (autoCompletedJobs.has(job.id)) return;
    if (!stops.every((s) => !!s.arrived_at)) return;

    // Respect the scheduled unloading time: don't auto-complete on drop arrival —
    // wait until the drop's scheduled departure (arrival + handling). The driver
    // can finish earlier via the "Confirm unloaded" button.
    const last = stops[stops.length - 1];
    const handlingMin = (job as { handling_minutes?: number | null }).handling_minutes ?? 20;
    const dropDepartMs = last.scheduled_at
      ? new Date(last.scheduled_at).getTime() + handlingMin * 60_000
      : 0;
    if (dropDepartMs && Date.now() < dropDepartMs) return;

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

function CopyButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* noop */
        }
      }}
      className="inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-surface-2"
    >
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
    </button>
  );
}

function RouteActionsMenu({
  effectiveStatus,
  onEdit,
  onClone,
  onCancel,
}: {
  effectiveStatus: string;
  onEdit: () => void;
  onClone: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item =
    "w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-xs hover:bg-surface-2";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="Route actions"
          className="inline-flex items-center justify-center size-8 rounded-md border border-border bg-surface hover:bg-surface-2 text-muted-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        {effectiveStatus !== "COMPLETED" && (
          <button
            className={`${item} text-foreground`}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <Pencil className="size-3.5 text-muted-foreground" /> Edit route
          </button>
        )}
        <button
          className={`${item} text-foreground`}
          onClick={() => {
            setOpen(false);
            onClone();
          }}
        >
          <CopyPlus className="size-3.5 text-muted-foreground" /> Clone route
        </button>
        {effectiveStatus !== "COMPLETED" && effectiveStatus !== "CANCELLED" && (
          <button
            className={`${item} text-red-600`}
            onClick={() => {
              setOpen(false);
              if (
                typeof window === "undefined" ||
                window.confirm("Cancel this route? It will move to the Cancelled tab.")
              )
                onCancel();
            }}
          >
            <Ban className="size-3.5" /> Cancel route
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
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
      title={
        disabled
          ? "Assign or plan a driver to view route on map"
          : "View this route on the live map"
      }
      className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/15 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <MapPin className="size-3" /> View on map
    </button>
  );
}
