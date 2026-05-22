import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";
import { DriverStopTimeline } from "@/components/driver/DriverStopTimeline";
import { STATUS_CONFIG } from "@/components/driver/DriverJobCard";
import { haversineKm, transitTimeHours, jobTotalMinutes, stopDwellMinutes, ARRIVAL_BUFFER_MINUTES } from "@/lib/geo";

export const Route = createFileRoute("/d/routes/$jobId")({
  head: () => ({ meta: [{ title: "Route — Driver" }] }),
  component: JobDetail,
});

function JobDetail() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const jobs = useDriverStore((s) => s.jobs);
  const driver = useDriverStore((s) => s.driver);
  const gps = useDriverStore((s) => s.gpsPosition);
  const job = jobs.find((j) => j.id === jobId);

  if (!job) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Route not found.</p>
        <Link to="/d/routes" className="text-primary text-sm mt-2 inline-block">← Back to routes</Link>
      </div>
    );
  }

  const onArrive = async (stopId: string) => {
    const now = new Date().toISOString();
    await supabase.from("job_stops").update({ arrived_at: now } as never).eq("id", stopId);
    if (driver) await supabase.from("driver_events").insert({ driver_id: driver.id, type: "ARRIVED", payload: { stop_id: stopId } } as never);
    useDriverStore.getState().setJobs(useDriverStore.getState().jobs.map((j) =>
      j.id !== job.id ? j : { ...j, stops: j.stops.map((s) => s.id === stopId ? { ...s, arrived_at: now } : s) }
    ));
  };

  const sortedStops = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);
  const allDone = sortedStops.length > 0 && sortedStops.every((s) => s.arrived_at);

  // Build warehouse + stop arrays for geo helpers
  const whs = sortedStops
    .map((s) => s.warehouse)
    .filter((w): w is NonNullable<typeof w> => !!w)
    .map((w) => ({ id: w.id, latitude: w.latitude, longitude: w.longitude }));
  const stopsForCalc = sortedStops
    .filter((s) => s.warehouse)
    .map((s) => ({ kind: s.kind, warehouse_id: s.warehouse_id }));

  const totalMin = stopsForCalc.length ? jobTotalMinutes(stopsForCalc, whs) : 0;
  const totalLabel = totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin}m`;

  // ETA at final stop = "now + remaining transit + remaining dwell"
  let etaFinalMs: number | null = null;
  let prevLat: number | null = gps?.lat ?? null;
  let prevLon: number | null = gps?.lon ?? null;
  let cursorMs = Date.now();
  for (let i = 0; i < sortedStops.length; i++) {
    const s = sortedStops[i];
    const wh = s.warehouse;
    if (!wh) continue;
    if (s.arrived_at) {
      cursorMs = Math.max(cursorMs, new Date(s.arrived_at).getTime());
    } else if (prevLat != null && prevLon != null) {
      const km = haversineKm(prevLat, prevLon, wh.latitude, wh.longitude);
      const transitMin = Math.round(transitTimeHours(km) * 60) + ARRIVAL_BUFFER_MINUTES;
      cursorMs += transitMin * 60_000;
    }
    if (i < sortedStops.length - 1) {
      cursorMs += stopDwellMinutes(s.kind) * 60_000;
    }
    prevLat = wh.latitude;
    prevLon = wh.longitude;
  }
  if (sortedStops.length > 0) etaFinalMs = cursorMs;

  const dateStr = job.for_date
    ? new Date(job.for_date + "T00:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
    : job.planned_start_at
    ? new Date(job.planned_start_at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
    : null;
  const startTime = job.planned_start_at
    ? new Date(job.planned_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : job.scheduled_at
    ? new Date(job.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const chain = sortedStops.map((s) => s.warehouse?.code ?? "?").join(" → ");

  const complete = async () => {
    await supabase.from("jobs").update({ status: "COMPLETED" } as never).eq("id", job.id);
    if (driver) await supabase.from("drivers").update({ status: "AVAILABLE" } as never).eq("id", driver.id);
    navigate({ to: "/d" });
  };

  return (
    <div className="pt-6 px-4">
      <button onClick={() => navigate({ to: "/d/routes" })} className="text-primary text-sm mb-4">← Routes</button>
      <h1 className="text-2xl font-bold text-foreground">{job.reference}</h1>
      <p className="text-sm text-muted-foreground mb-4">{sortedStops.length} stops</p>

      <div className="mb-6 bg-card border border-border rounded-2xl p-4 space-y-2 text-sm">
        {dateStr && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">📅</span>
            <span className="font-semibold text-foreground">{dateStr}</span>
            {startTime && <span className="text-muted-foreground font-mono">· start {startTime}</span>}
          </div>
        )}
        {chain && (
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground">🧭</span>
            <span className="font-bold text-foreground break-all">{chain}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">⏱</span>
          <span className="text-foreground">Total transit + dwell: <span className="font-semibold">{totalLabel}</span></span>
        </div>
        {etaFinalMs != null && !allDone && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">🏁</span>
            <span className="text-foreground">
              ETA final stop:{" "}
              <span className="font-semibold font-mono">
                {new Date(etaFinalMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              {!gps && <span className="text-xs text-muted-foreground ml-1">(awaiting GPS)</span>}
            </span>
          </div>
        )}
      </div>

      <DriverStopTimeline job={{ ...job, stops: sortedStops }} driverPosition={gps} onArrive={onArrive} />

      {allDone && job.status !== "COMPLETED" && (
        <button onClick={complete}
          className="mt-4 w-full bg-success text-success-foreground font-bold py-4 rounded-xl active:scale-[0.99] transition">
          Complete route
        </button>
      )}
    </div>
  );
}
