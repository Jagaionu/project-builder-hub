import type { Job } from "@/lib/types";
import type { JobStopsMap } from "@/lib/dispatch/use-job-stops";
import type { PlannedAssign } from "@/lib/planner";

export type TourInfo = { seq: number; size: number };

// A tour is a CHAIN of jobs for one driver where each job's drop is the next
// job's pickup (e.g. SNG1->HOME then HOME->BHX2, linked at HOME), back-to-back
// in time. Only genuinely chained jobs are marked — not every job a driver
// happens to have — and separate days are never merged into one tour.
export function computeTours(
  jobs: Job[],
  stopsMap: JobStopsMap,
  plannedByJob: Map<string, PlannedAssign>,
): Map<string, TourInfo> {
  type Info = {
    jobId: string;
    driverId: string;
    firstWh: string | null;
    lastWh: string | null;
    startMs: number;
  };

  const driverOf = (j: Job): string | null =>
    j.assigned_driver_id ?? plannedByJob.get(j.id)?.driverId ?? j.planned_driver_id ?? null;

  const byDriver = new Map<string, Info[]>();
  for (const j of jobs) {
    const driverId = driverOf(j);
    if (!driverId) continue;
    const st = stopsMap[j.id] ?? [];
    if (st.length === 0) continue;
    const startMs = j.scheduled_at
      ? Number(new Date(j.scheduled_at))
      : st[0]?.scheduled_at
        ? Number(new Date(st[0].scheduled_at))
        : 0;
    const info: Info = {
      jobId: j.id,
      driverId,
      firstWh: st[0]?.warehouse_id ?? null,
      lastWh: st[st.length - 1]?.warehouse_id ?? null,
      startMs,
    };
    const arr = byDriver.get(driverId);
    if (arr) arr.push(info);
    else byDriver.set(driverId, [info]);
  }

  // Consecutive (by time) jobs chain only when the first job's drop equals the
  // next job's pickup AND they fall within one operational window (12h), which
  // prevents separate days collapsing into one tour.
  const MAX_GAP_MS = 12 * 60 * 60 * 1000;
  const out = new Map<string, TourInfo>();
  for (const list of byDriver.values()) {
    list.sort((a, b) => a.startMs - b.startMs);
    let i = 0;
    while (i < list.length) {
      const chain: Info[] = [list[i]];
      let k = i + 1;
      while (
        k < list.length &&
        !!chain[chain.length - 1].lastWh &&
        chain[chain.length - 1].lastWh === list[k].firstWh &&
        list[k].startMs >= chain[chain.length - 1].startMs &&
        list[k].startMs - chain[chain.length - 1].startMs <= MAX_GAP_MS
      ) {
        chain.push(list[k]);
        k++;
      }
      chain.forEach((c, idx) => out.set(c.jobId, { seq: idx + 1, size: chain.length }));
      i = k;
    }
  }
  return out;
}
