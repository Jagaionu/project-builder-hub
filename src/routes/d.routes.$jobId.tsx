import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { useDriverStore } from "@/lib/driver-store";
import { DriverStopTimeline } from "@/components/driver/DriverStopTimeline";
import { STATUS_CONFIG } from "@/components/driver/DriverJobCard";
import {
  haversineKm,
  transitTimeHours,
  jobTotalMinutes,
  stopDwellMinutes,
  ARRIVAL_BUFFER_MINUTES,
} from "@/lib/geo";

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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  if (!job) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Route not found.</p>
        <Link to="/d" className="text-primary text-sm mt-2 inline-block">
          ← Back to home
        </Link>
      </div>
    );
  }

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

  const hm = (job as { handling_minutes?: number | null }).handling_minutes ?? undefined;
  const totalMin = stopsForCalc.length ? jobTotalMinutes(stopsForCalc, whs, hm) : 0;
  const totalLabel =
    totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin}m`;

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
      cursorMs += stopDwellMinutes(s.kind, hm) * 60_000;
    }
    prevLat = wh.latitude;
    prevLon = wh.longitude;
  }
  if (sortedStops.length > 0) etaFinalMs = cursorMs;

  const dateStr = job.for_date
    ? new Date(job.for_date + "T00:00:00").toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : job.planned_start_at
      ? new Date(job.planned_start_at).toLocaleDateString([], {
          weekday: "long",
          month: "short",
          day: "numeric",
        })
      : null;
  const startTime = job.planned_start_at
    ? new Date(job.planned_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : job.scheduled_at
      ? new Date(job.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;
  const chain = sortedStops.map((s) => s.warehouse?.code ?? "?").join(" → ");

  const statusCfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.PENDING;

  const cantComplete = async () => {
    if (!driver) return;
    if (typeof window !== "undefined" && !window.confirm("Mark this route as can't complete?"))
      return;
    setBusy(true);
    try {
      await supabase
        .from("jobs")
        .update({ status: "PENDING", assigned_driver_id: null, planned_driver_id: null } as never)
        .eq("id", job.id);
      await supabase
        .from("drivers")
        .update({ status: "AVAILABLE" } as never)
        .eq("id", driver.id);
      await supabase
        .from("driver_events")
        .insert({
          driver_id: driver.id,
          type: "CANT_COMPLETE",
          payload: {
            job_id: job.id,
            job_reference: job.reference,
            driver_name: driver.name,
            reason: "Driver reported cannot complete",
          },
          tenant_id: await getTenantId(),
        } as never);
      toast.success("Reported — dispatcher notified");
      navigate({ to: "/d" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!driver || !note.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("driver_events").insert({
        driver_id: driver.id,
        type: "DRIVER_NOTE",
        payload: { job_id: job.id, note: note.trim() },
        tenant_id: await getTenantId(),
      } as never);
      if (error) throw error;
      setNote("");
      toast.success("Note saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  };

  const showCantComplete =
    job.status === "IN_PROGRESS" ||
    job.status === "ARRIVED_PICKUP" ||
    job.status === "EN_ROUTE_DELIVERY";

  return (
    <div className="pt-6 px-4 max-w-md mx-auto pb-12">
      <button onClick={() => navigate({ to: "/d" })} className="text-primary text-sm mb-4">
        ← Home
      </button>
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-foreground">{job.reference}</h1>
        <span
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${statusCfg.bg} ${statusCfg.color}`}
        >
          {statusCfg.label}
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{sortedStops.length} stops</p>

      {showCantComplete && (
        <div className="mb-4 flex gap-2">
          <button
            onClick={cantComplete}
            disabled={busy}
            className="flex-1 bg-muted text-muted-foreground font-semibold py-3 rounded-xl active:scale-[0.99] transition disabled:opacity-50"
          >
            🚫 Can't complete
          </button>
        </div>
      )}

      <div className="mb-6 bg-card border border-border rounded-2xl p-4 space-y-2 text-sm">
        {dateStr && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">📅</span>
            <span className="font-semibold text-foreground">{dateStr}</span>
            {startTime && (
              <span className="text-muted-foreground font-mono">· start {startTime}</span>
            )}
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
          <span className="text-foreground">
            Total transit + dwell: <span className="font-semibold">{totalLabel}</span>
          </span>
        </div>
        {etaFinalMs != null && !allDone && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">🏁</span>
            <span className="text-foreground">
              ETA final stop:{" "}
              <span className="font-semibold font-mono">
                {new Date(etaFinalMs).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {!gps && <span className="text-xs text-muted-foreground ml-1">(awaiting GPS)</span>}
            </span>
          </div>
        )}
      </div>

      <DriverStopTimeline
        job={{ ...job, stops: sortedStops }}
        driverPosition={gps}
        onArrive={async (stopId) => {
          const now = new Date().toISOString();
          const { error } = await supabase
            .from("job_stops")
            .update({ arrived_at: now } as never)
            .eq("id", stopId)
            .is("arrived_at", null);
          if (error) return;

          // Transition to IN_PROGRESS on arrival
          if (job.status === "ASSIGNED") {
            await supabase
              .from("jobs")
              .update({ status: "IN_PROGRESS" } as never)
              .eq("id", job.id);
          }

          await supabase.from("driver_events").insert({
            driver_id: driver?.id,
            type: "ARRIVED",
            payload: { stop_id: stopId, job_id: job.id, auto: false },
            tenant_id: await getTenantId(),
          } as never);
        }}
      />

      <p className="mt-2 text-xs text-muted-foreground text-center">
        Arrivals are confirmed automatically when you reach each stop.
      </p>


      <div className="mt-6 bg-card border border-border rounded-2xl p-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Notes
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note for the dispatcher…"
          rows={3}
          className="w-full bg-background border border-border rounded-lg p-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          onClick={saveNote}
          disabled={busy || !note.trim()}
          className="mt-2 w-full bg-primary text-primary-foreground font-semibold text-sm py-2.5 rounded-lg active:scale-[0.99] transition disabled:opacity-40"
        >
          Save note
        </button>
      </div>
    </div>
  );
}
