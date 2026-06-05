import { haversineKm } from "@/lib/driver-gps";
import type { JobWithStops, DriverStop } from "@/lib/driver-types";
import { openLeg, closeLeg, openDwell, closeDwell } from "@/lib/driving-legs.functions";
import { useDriverStore } from "@/lib/driver-store";
import { transitTimeHours } from "@/lib/geo";
import { supabase } from "@/integrations/supabase/client";

const ARRIVAL_RADIUS_M = 200;
const DEPARTURE_RADIUS_M = 300;
// GPS pings arrive ~every 5 min, so the first "moved" ping means the driver
// actually left during the prior interval. Backdate the recorded departure by
// one ping interval (clamped to not precede arrival) so transit/dwell learning
// reflects reality rather than the scheduled or last-detected time.
const DEPARTURE_BACKDATE_MS = 5 * 60_000;

function pickActiveJob(jobs: JobWithStops[]): JobWithStops | null {
  return (
    jobs.find((j) =>
      ["IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY", "ASSIGNED"].includes(j.status),
    ) ?? null
  );
}

function findWh(stops: DriverStop[], whId: string) {
  return stops.map((s) => s.warehouse).find((w) => w?.id === whId) ?? null;
}

let inFlight = false;

export async function checkGeofences(
  pos: { lat: number; lon: number; ts: number },
  driverId: string,
) {
  if (inFlight) return;
  inFlight = true;
  try {
    const jobs = useDriverStore.getState().jobs;
    const job = pickActiveJob(jobs);
    if (!job) return;
    const sorted = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);
    if (sorted.length === 0) return;

    const legState = useDriverStore.getState().legState;
    const setLegState = useDriverStore.getState().setLegState;
    const nowIso = new Date(pos.ts).toISOString();

    // Switching jobs — reset state
    if (legState.currentJobId && legState.currentJobId !== job.id) {
      setLegState({
        activeLegId: null,
        activeDwellId: null,
        currentJobId: job.id,
        lastKnownWarehouseId: null,
      });
      return;
    }

    // ── Active dwell: detect departure (>300m) → close dwell + open next leg
    if (legState.activeDwellId && legState.lastKnownWarehouseId) {
      const lastWh = findWh(sorted, legState.lastKnownWarehouseId);
      if (lastWh) {
        const distM = haversineKm(pos.lat, pos.lon, lastWh.latitude, lastWh.longitude) * 1000;
        if (distM > DEPARTURE_RADIUS_M) {
          // Real departure happened during the previous ping interval — backdate
          // it (never before arrival at this stop) for accurate transit/dwell.
          const dwelledStop = sorted.find((s) => s.warehouse_id === lastWh.id && s.arrived_at);
          const arrivedMs = dwelledStop?.arrived_at ? new Date(dwelledStop.arrived_at).getTime() : 0;
          const departedIso = new Date(Math.max(arrivedMs, pos.ts - DEPARTURE_BACKDATE_MS)).toISOString();
          await closeDwell({ data: { dwellId: legState.activeDwellId, departedAt: departedIso } }).catch(
            (e) => console.error("[legs] closeDwell", e),
          );
          // Record the actual (GPS-derived) departure on the stop the driver left.
          if (dwelledStop?.id) {
            await supabase
              .from("job_stops")
              .update({ departed_at: departedIso } as never)
              .eq("id", dwelledStop.id);
          }
          const nextStop = sorted.find((s) => !s.arrived_at);
          if (!nextStop?.warehouse) {
            setLegState({
              activeLegId: null,
              activeDwellId: null,
              currentJobId: job.id,
              lastKnownWarehouseId: lastWh.id,
            });
            return;
          }
          const nextWh = nextStop.warehouse;
          const plannedMin = Math.round(
            transitTimeHours(
              haversineKm(lastWh.latitude, lastWh.longitude, nextWh.latitude, nextWh.longitude),
            ) * 60,
          );
          try {
            const r = await openLeg({
              data: {
                driverId,
                jobId: job.id,
                fromWarehouseId: lastWh.id,
                fromLabel: lastWh.code,
                fromLat: lastWh.latitude,
                fromLon: lastWh.longitude,
                toWarehouseId: nextWh.id,
                toLabel: nextWh.code,
                toLat: nextWh.latitude,
                toLon: nextWh.longitude,
                departedAt: departedIso,
                plannedMinutes: plannedMin,
              },
            });
            setLegState({
              activeLegId: r.id,
              activeDwellId: null,
              currentJobId: job.id,
              lastKnownWarehouseId: lastWh.id,
            });
          } catch (e) {
            console.error("[legs] openLeg chain", e);
          }
        }
      }
      return;
    }

    const nextStop = sorted.find((s) => !s.arrived_at);
    if (!nextStop?.warehouse) return;
    const nextWh = nextStop.warehouse;
    const distToNextM = haversineKm(pos.lat, pos.lon, nextWh.latitude, nextWh.longitude) * 1000;

    // ── Active leg: detect arrival (<200m) → close leg + open dwell
    if (legState.activeLegId) {
      if (distToNextM < ARRIVAL_RADIUS_M) {
        await closeLeg({
          data: {
            legId: legState.activeLegId,
            arrivedAt: nowIso,
            actualLat: pos.lat,
            actualLon: pos.lon,
          },
        }).catch((e) => console.error("[legs] closeLeg", e));
        await supabase
          .from("job_stops")
          .update({ arrived_at: nowIso } as never)
          .eq("id", nextStop.id)
          .is("arrived_at", null);

        // Auto-transition status on arrival
        if (job.status === "ASSIGNED") {
          await supabase
            .from("jobs")
            .update({ status: "IN_PROGRESS" } as never)
            .eq("id", job.id);
        }

        await supabase.from("driver_events").insert({
          driver_id: driverId,
          type: "ARRIVED",
          payload: { stop_id: nextStop.id, job_id: job.id, auto: true },
        } as never);
        try {
          const r = await openDwell({
            data: {
              driverId,
              jobId: job.id,
              jobStopId: nextStop.id,
              warehouseId: nextWh.id,
              kind: nextStop.kind,
              arrivedAt: nowIso,
            },
          });
          setLegState({
            activeLegId: null,
            activeDwellId: r.id,
            currentJobId: job.id,
            lastKnownWarehouseId: nextWh.id,
          });
          // Update local jobs cache
          useDriverStore
            .getState()
            .setJobs(
              useDriverStore
                .getState()
                .jobs.map((j) =>
                  j.id !== job.id
                    ? j
                    : {
                        ...j,
                        stops: j.stops.map((s) =>
                          s.id === nextStop.id ? { ...s, arrived_at: nowIso } : s,
                        ),
                      },
                ),
            );
        } catch (e) {
          console.error("[legs] openDwell", e);
        }
      }
      return;
    }

    // ── No active state: open initial (deadhead) leg if driver started moving
    if (["IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(job.status)) {
      if (distToNextM > DEPARTURE_RADIUS_M) {
        const plannedMin = Math.round(
          transitTimeHours(haversineKm(pos.lat, pos.lon, nextWh.latitude, nextWh.longitude)) * 60,
        );
        try {
          const r = await openLeg({
            data: {
              driverId,
              jobId: job.id,
              fromWarehouseId: null,
              fromLabel: "Start",
              fromLat: pos.lat,
              fromLon: pos.lon,
              toWarehouseId: nextWh.id,
              toLabel: nextWh.code,
              toLat: nextWh.latitude,
              toLon: nextWh.longitude,
              departedAt: new Date(pos.ts - DEPARTURE_BACKDATE_MS).toISOString(),
              plannedMinutes: plannedMin,
            },
          });
          setLegState({
            activeLegId: r.id,
            activeDwellId: null,
            currentJobId: job.id,
            lastKnownWarehouseId: null,
          });
        } catch (e) {
          console.error("[legs] openLeg deadhead", e);
        }
      } else if (distToNextM < ARRIVAL_RADIUS_M) {
        await supabase
          .from("job_stops")
          .update({ arrived_at: nowIso } as never)
          .eq("id", nextStop.id)
          .is("arrived_at", null);
        try {
          const r = await openDwell({
            data: {
              driverId,
              jobId: job.id,
              jobStopId: nextStop.id,
              warehouseId: nextWh.id,
              kind: nextStop.kind,
              arrivedAt: nowIso,
            },
          });
          setLegState({
            activeLegId: null,
            activeDwellId: r.id,
            currentJobId: job.id,
            lastKnownWarehouseId: nextWh.id,
          });
        } catch (e) {
          console.error("[legs] openDwell direct", e);
        }
      }
    }
  } finally {
    inFlight = false;
  }
}
