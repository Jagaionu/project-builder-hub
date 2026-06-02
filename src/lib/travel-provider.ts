// TravelProvider — builds a TravelFn from your lane_travel_times rows so the
// optimizer plans on real road times (p50 by lane + day-of-week + hour-of-day)
// instead of straight-line distance.
//
// Lookup order for a (from → to) leg departing at departMs:
//   1. exact lane for (from, to, UTC day-of-week, UTC hour-of-day)
//   2. lane average across all hours for (from, to)
//   3. haversine + the geo speed model (covers GPS→warehouse legs with no lane)
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
}

export function makeTravelHours(rows: LaneTimeRow[]): TravelFn {
  const exact = new Map<string, number>(); // from|to|dow|hour -> minutes
  const laneAgg = new Map<string, { sum: number; n: number }>(); // from|to -> minutes

  for (const r of rows) {
    const mins = r.p50_duration_minutes ?? r.avg_duration_minutes ?? null;
    if (mins == null) continue;
    exact.set(`${r.from_warehouse_id}|${r.to_warehouse_id}|${r.day_of_week}|${r.hour_of_day}`, mins);
    const k = `${r.from_warehouse_id}|${r.to_warehouse_id}`;
    const agg = laneAgg.get(k) ?? { sum: 0, n: 0 };
    agg.sum += mins;
    agg.n += 1;
    laneAgg.set(k, agg);
  }

  return (from: GeoPoint, to: GeoPoint, departMs: number): number => {
    if (from.whId && to.whId) {
      const d = new Date(departMs);
      const e = exact.get(`${from.whId}|${to.whId}|${d.getUTCDay()}|${d.getUTCHours()}`);
      if (e != null) return e / 60;
      const agg = laneAgg.get(`${from.whId}|${to.whId}`);
      if (agg && agg.n > 0) return agg.sum / agg.n / 60;
    }
    return transitTimeHours(haversineKm(from.lat, from.lon, to.lat, to.lon));
  };
}
