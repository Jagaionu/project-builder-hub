// Server-side run completion + arrival fallback (runs via pg_cron, independent
// of any browser or the driver's GPS loop).
//
// Root cause it fixes: the only existing arrival-fallback (useAutoValidateArrivals)
// and auto-completion (useAutoComplete) live in the dispatch detail panel and
// only run while a dispatcher has that job open; the driver-GPS path stops the
// moment the driver parks or closes the app. So a finished run could sit at
// IN_PROGRESS forever. This sweep mirrors both behaviours on the server.
//
// Safety: it only ever touches jobs in an ACTIVE status. When a driver reports a
// problem, the job is moved to PENDING with a CANT_COMPLETE event, so it leaves
// the active set and this sweep never auto-completes it.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

const ACTIVE_STATUSES = ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"];
// Mark a stop arrived (at its planned time) once it is this many minutes past
// the planned time with no GPS-recorded arrival.
const ARRIVAL_GRACE_MIN = 15;
const DEFAULT_HANDLING_MIN = 20;

export interface CompleteRunsSweepResult {
  scanned: number;
  arrivalsMarked: number;
  runsCompleted: number;
}

export async function runCompleteRunsSweep(): Promise<CompleteRunsSweepResult> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: jobsData } = await sb
    .from("jobs")
    .select("id, reference, status, assigned_driver_id, handling_minutes, tenant_id")
    .in("status", ACTIVE_STATUSES);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobs = (jobsData ?? []) as Array<any>;

  let arrivalsMarked = 0;
  let runsCompleted = 0;

  for (const job of jobs) {
    const { data: stopsData } = await sb
      .from("job_stops")
      .select("id, seq, kind, scheduled_at, arrived_at, departed_at")
      .eq("job_id", job.id)
      .order("seq", { ascending: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stops = (stopsData ?? []) as Array<any>;
    if (stops.length === 0) continue;

    // 1) Arrival fallback: a stop > ARRIVAL_GRACE_MIN past its planned time with
    //    no recorded arrival is stamped at the planned time (the driver wasn't
    //    actively tracking; the GPS geofence would otherwise have set it).
    for (const s of stops) {
      if (s.arrived_at || !s.scheduled_at) continue;
      const plannedMs = new Date(s.scheduled_at).getTime();
      if (!plannedMs || now - plannedMs < ARRIVAL_GRACE_MIN * 60_000) continue;
      const { error } = await sb
        .from("job_stops")
        .update({ arrived_at: s.scheduled_at })
        .eq("id", s.id)
        .is("arrived_at", null);
      if (!error) {
        s.arrived_at = s.scheduled_at;
        arrivalsMarked += 1;
      }
    }

    // 2) Completion: every stop has arrived AND the drop's unload window has
    //    passed (last drop planned time + handling).
    if (!stops.every((s) => !!s.arrived_at)) continue;
    const drops = stops.filter((s) => s.kind === "DROP" && s.scheduled_at);
    const lastDrop = drops.length ? drops[drops.length - 1] : stops[stops.length - 1];
    const handlingMin = (job.handling_minutes ?? DEFAULT_HANDLING_MIN) as number;
    const dropDepartMs = lastDrop?.scheduled_at
      ? new Date(lastDrop.scheduled_at).getTime() + handlingMin * 60_000
      : 0;
    if (dropDepartMs && now < dropDepartMs) continue;

    // Complete (guard the status in the WHERE so we never clobber a concurrent
    // manual completion / cancellation).
    const { error: jobErr } = await sb
      .from("jobs")
      .update({ status: "COMPLETED" })
      .eq("id", job.id)
      .in("status", ACTIVE_STATUSES);
    if (jobErr) continue;

    if (job.assigned_driver_id) {
      await sb.from("drivers").update({ status: "AVAILABLE" }).eq("id", job.assigned_driver_id);
    }
    const finalStop = stops[stops.length - 1];
    if (finalStop && !finalStop.departed_at) {
      await sb
        .from("job_stops")
        .update({ departed_at: nowIso })
        .eq("id", finalStop.id)
        .is("departed_at", null);
    }
    // Tidy any dwell left open by the driver app.
    await sb.from("stop_dwells").update({ departed_at: nowIso }).eq("job_id", job.id).is("departed_at", null);

    await sb.from("driver_events").insert({
      driver_id: job.assigned_driver_id ?? null,
      type: "UNLOADED",
      payload: { job_id: job.id, job_reference: job.reference, auto: true, via: "server-sweep" },
      tenant_id: job.tenant_id ?? null,
    });
    runsCompleted += 1;
  }

  return { scanned: jobs.length, arrivalsMarked, runsCompleted };
}
