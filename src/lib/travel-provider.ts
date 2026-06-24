// TravelProvider — builds a TravelFn from your lane_travel_times rows so the
// optimizer plans on real road times instead of straight-line distance.
//
// Lookup order for a (from → to) leg departing at departMs:
//   1. exact lane for (from, to, UTC day-of-week, UTC hour-of-day)
//   2. same day-of-week average across hours   (preserves the Monday-busier
//      signal when that exact hour has no samples)
//   3. lane average across all days/hours
//   4. haversine + the geo speed model (covers GPS→warehouse legs with no lane)
//
// For an exact bucket the planned time reacts upward quickly when the recent
// window has enough samples (road works / a newly busier lane), then an optional
// p90 reliability buffer is applied. Both are no-ops unless the data is present
// and the buffer is enabled, so behaviour is unchanged until those are wired —
// the function stays a pure, deterministic function of its input rows.
//
// Usage (worker):
//   const { data } = await client.from("lane_travel_times").select(
//     "from_warehouse_id,to_warehouse_id,day_of_week,hour_of_day,p50_duration_minutes,avg_duration_minutes");
//   planDay({ ..., travelHours: makeTravelHours(data ?? []) });

import type { GeoPoint, TravelFn } from "./route-optimizer";
import { haversineKm, transitTimeHours } from "./geo";

export interface LaneTimeRow {
  from_warehouse_id: string;
  to_warehouse_id: string;
  day_of_week: number; // 0=Sun..6=Sat
  hour_of_day: number; // 0..23
  p50_duration_minutes: number | null;
  avg_duration_minutes?: number | null;
  p90_duration_minutes?: number | null;
  // Rolling recent-window stats (populated by the aggregation cron). Optional so
  // callers that don't select them keep the historical (90-day median) behaviour.
  recent_p50_duration_minutes?: number | null;
  recent_sample_count?: number | null;
}

// Minimum recent samples before we trust the recent window enough to let it move
// the planned time. Below this we stick with the stable 90-day median.
export const MIN_RECENT_SAMPLES = 5;
// Fraction of the (p90 − base) spread added as a reliability buffer on
// high-variance lanes. 0 = plan on the median (historical behaviour). Raise only
// after benchmarking with real lane data.
export const TRANSIT_BUFFER = 0;

type Bucket = {
  p50: number;
  p90: number | null;
  recentP50: number | null;
  recentN: number | null;
};

export function makeTravelHours(rows: LaneTimeRow[]): TravelFn {
  const exact = new Map<string, Bucket>(); // from|to|dow|hour -> bucket
  const dowAgg = new Map<string, { sum: number; n: number }>(); // from|to|dow -> minutes
  const laneAgg = new Map<string, { sum: number; n: number }>(); // from|to -> minutes

  for (const r of rows) {
    const mins = r.p50_duration_minutes ?? r.avg_duration_minutes ?? null;
    if (mins == null) continue;
    exact.set(`${r.from_warehouse_id}|${r.to_warehouse_id}|${r.day_of_week}|${r.hour_of_day}`, {
      p50: mins,
      p90: r.p90_duration_minutes ?? null,
      recentP50: r.recent_p50_duration_minutes ?? null,
      recentN: r.recent_sample_count ?? null,
    });
    const dk = `${r.from_warehouse_id}|${r.to_warehouse_id}|${r.day_of_week}`;
    const da = dowAgg.get(dk) ?? { sum: 0, n: 0 };
    da.sum += mins;
    da.n += 1;
    dowAgg.set(dk, da);
    const lk = `${r.from_warehouse_id}|${r.to_warehouse_id}`;
    const la = laneAgg.get(lk) ?? { sum: 0, n: 0 };
    la.sum += mins;
    la.n += 1;
    laneAgg.set(lk, la);
  }

  // Effective minutes for an exact bucket: react upward fast when the recent
  // window has enough samples, then apply the (default-off) variance buffer.
  const effective = (b: Bucket): number => {
    let base = b.p50;
    if (b.recentN != null && b.recentN >= MIN_RECENT_SAMPLES && b.recentP50 != null) {
      base = Math.max(base, b.recentP50);
    }
    if (TRANSIT_BUFFER > 0 && b.p90 != null && b.p90 > base) {
      base = base + TRANSIT_BUFFER * (b.p90 - base);
    }
    return base;
  };

  return (from: GeoPoint, to: GeoPoint, departMs: number): number => {
    if (from.whId && to.whId) {
      const d = new Date(departMs);
      const dow = d.getUTCDay();
      const e = exact.get(`${from.whId}|${to.whId}|${dow}|${d.getUTCHours()}`);
      if (e != null) return effective(e) / 60;
      // Preserve the day-of-week signal when this exact hour has no samples.
      const da = dowAgg.get(`${from.whId}|${to.whId}|${dow}`);
      if (da && da.n > 0) return da.sum / da.n / 60;
      const la = laneAgg.get(`${from.whId}|${to.whId}`);
      if (la && la.n > 0) return la.sum / la.n / 60;
    }
    return transitTimeHours(haversineKm(from.lat, from.lon, to.lat, to.lon));
  };
}
