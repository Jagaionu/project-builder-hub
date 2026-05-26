import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { computePlan } from "@/lib/planner";
import { computeStopSchedule } from "@/lib/geo";
import type { Job, Warehouse } from "@/lib/types";
import type { JobStopsMap, Stop } from "./use-job-stops";
import { applyJobPatch } from "@/lib/hooks";

type AssignDriver = (jobId: string, driverId: string) => Promise<void>;
type Plan = ReturnType<typeof computePlan>;

/**
 * Batched, single-round-trip auto-planner. Consumes a precomputed `plan`
 * (memoized once in dispatch.tsx) instead of re-running computePlan here —
 * which previously meant the planner ran TWICE per data change.
 *
 *  - Skips jobs flagged manual_override.
 *  - Coalesces all "clear planned fields" into one .in() update.
 *  - Applies per-row updates in parallel.
 *  - Stop-time fills run in parallel via Promise.all.
 */
export function useAutoPlanner(args: {
  plan: Plan;
  jobs: Job[];
  stopsMap: JobStopsMap;
  warehouses: Warehouse[];
  assignDriver: AssignDriver;
}) {
  const { plan, jobs, stopsMap, warehouses, assignDriver } = args;

  const planSigRef = useRef<string>("");
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (inFlightRef.current) return;

    const pending = jobs.filter((j) => j.status === "PENDING" && !j.assigned_driver_id);
    if (pending.some((j) => !stopsMap[j.id])) return;

    const sig = JSON.stringify({
      i: plan.immediate.map((x) => [x.jobId, x.driverId]),
      p: plan.planned.map((x) => [x.jobId, x.driverId, x.sequence, x.startAt]),
    });
    if (sig === planSigRef.current) return;
    planSigRef.current = sig;

    inFlightRef.current = true;
    void (async () => {
      try {
        await runPlan(plan, jobs, stopsMap, warehouses, assignDriver);
      } catch (err) {
        console.error("[auto-planner] failed", err);
      } finally {
        inFlightRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, jobs, stopsMap, warehouses]);
}

async function runPlan(
  plan: ReturnType<typeof computePlan>,
  jobs: Job[],
  stopsMap: JobStopsMap,
  warehouses: Warehouse[],
  assignDriver: AssignDriver,
) {
  // Pass 1 — immediate assignments. Serial per-job to avoid races on
  // driver status. Stop-time fills are parallel within the pass.
  const fillPromises: Array<Promise<void>> = [];
  for (const a of plan.immediate) {
    const job = jobs.find((j) => j.id === a.jobId);
    if (!job || job.manual_override) continue;
    await assignDriver(a.jobId, a.driverId);
    fillPromises.push(
      fillStopTimes(job.scheduled_at ?? new Date().toISOString(), stopsMap[a.jobId] ?? [], warehouses),
    );
  }
  await Promise.all(fillPromises);

  // Pass 2 — planned (not-yet-assigned) follow-on routes.
  const desired = new Map(plan.planned.map((p) => [p.jobId, p] as const));
  const toClear: string[] = [];
  type DesiredUpdate = { id: string; planned_driver_id: string; planned_sequence: number; planned_start_at: string };
  const toApply: DesiredUpdate[] = [];
  const toFill: Array<{ id: string; startAt: string }> = [];

  for (const job of jobs) {
    if (job.manual_override) continue;
    const want = desired.get(job.id);
    const havePlanned = !!(job.planned_driver_id || job.planned_sequence || job.planned_start_at);

    if (!want) {
      if (havePlanned) toClear.push(job.id);
      continue;
    }

    const drift =
      job.planned_driver_id !== want.driverId ||
      job.planned_sequence !== want.sequence ||
      job.planned_start_at !== want.startAt;
    if (drift) {
      toApply.push({
        id: job.id,
        planned_driver_id: want.driverId,
        planned_sequence: want.sequence,
        planned_start_at: want.startAt,
      });
      toFill.push({ id: job.id, startAt: want.startAt });
    }
  }

  if (toClear.length) {
    const { error } = await supabase
      .from("jobs")
      .update({ planned_driver_id: null, planned_sequence: null, planned_start_at: null })
      .in("id", toClear);
    if (error) console.error("[auto-planner] clear failed", error.message);
    else for (const id of toClear) {
      applyJobPatch(id, { planned_driver_id: null, planned_sequence: null, planned_start_at: null });
    }
  }

  if (toApply.length) {
    await Promise.all(toApply.map(async (u) => {
      const { id, ...patch } = u;
      const { error } = await supabase.from("jobs").update(patch).eq("id", id);
      if (error) console.error("[auto-planner] update failed", id, error.message);
      else applyJobPatch(id, patch);
    }));
  }

  await Promise.all(
    toFill.map((f) => fillStopTimes(f.startAt, stopsMap[f.id] ?? [], warehouses)),
  );
}

/**
 * Updates job_stops.scheduled_at for every stop where the computed time
 * differs from what's stored. One PATCH per changed row, in parallel.
 */
export async function fillStopTimes(
  jobStart: string | null,
  stops: Stop[],
  warehouses: Warehouse[],
): Promise<void> {
  if (!jobStart || stops.length === 0) return;
  const times = computeStopSchedule(stops, jobStart, warehouses);
  const writes: Array<Promise<unknown>> = [];
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const t = times[i];
    if (!s.id || !t) continue;
    if (s.scheduled_at === t) continue;
    writes.push(Promise.resolve(supabase.from("job_stops").update({ scheduled_at: t }).eq("id", s.id)));
  }
  await Promise.all(writes);
}
