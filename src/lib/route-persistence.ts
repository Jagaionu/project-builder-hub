// route-persistence.ts — Pure mapper from OptResult to rows for the routes and
// route_jobs tables. The worker does the actual INSERTs and links route_jobs to
// the generated routes.id.
//
// NEVER writes planned times back into job_stops.scheduled_at — that was the
// non-determinism bug that corrupted the lane_travel_times training data.

import type { OptResult } from "@/lib/route-optimizer";
import type { OptAssignment, OptReturnLeg, OptRouteSummary } from "@/lib/route-optimizer";

export interface RouteRow {
  tenant_id?: string;
  driver_id: string;
  route_date: string;
  planner_run_id: string;
  start_at: string;
  end_at: string;
  total_drive_minutes: number;
  total_deadhead_km: number;
  job_count: number;
  ends_at_home: boolean;
}

export interface RouteJobRow {
  job_id: string;
  sequence: number;
  start_at: string;
  arrive_at: string;
  late_minutes: number;
}

export interface PersistedRoute {
  route: RouteRow;
  jobs: RouteJobRow[];
}

export function toRoutePersistence(
  result: OptResult,
  meta: { tenantId?: string; routeDate: string; plannerRunId: string },
): PersistedRoute[] {
  const summariesByDriver: Record<string, OptRouteSummary[]> = {};
  for (const s of result.routeSummaries) {
    (summariesByDriver[s.driverId] ??= []).push(s);
  }
  const assignmentsByDriver: Record<string, OptAssignment[]> = {};
  for (const a of result.assignments) {
    (assignmentsByDriver[a.driverId] ??= []).push(a);
  }

  const out: PersistedRoute[] = [];
  for (const driverId of Object.keys(summariesByDriver).sort()) {
    const summaries = summariesByDriver[driverId];
    const assignments = (assignmentsByDriver[driverId] ?? []).sort((a, b) => a.sequence - b.sequence);
    if (assignments.length === 0) continue;

    const totalDriveMin = summaries.reduce((s, sm) => s + sm.driveHours * 60, 0);
    const totalDeadheadKm = summaries.reduce((s, sm) => s + sm.deadheadKm, 0);

    out.push({
      route: {
        tenant_id: meta.tenantId,
        driver_id: driverId,
        route_date: meta.routeDate,
        planner_run_id: meta.plannerRunId,
        start_at: summaries[0].startAt,
        end_at: summaries[summaries.length - 1].endAt,
        total_drive_minutes: Math.round(totalDriveMin),
        total_deadhead_km: Math.round(totalDeadheadKm * 100) / 100,
        job_count: assignments.length,
        ends_at_home: summaries.some((s) => s.endsAtHome),
      },
      jobs: assignments.map((a) => ({
        job_id: a.jobId,
        sequence: a.sequence,
        start_at: a.startAt,
        arrive_at: a.arriveAt,
        late_minutes: a.lateMinutes,
      })),
    });
  }
  return out;
}
