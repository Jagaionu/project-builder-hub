import { describe, it, expect } from "vitest";
import { makeTravelHours, type LaneTimeRow } from "./travel-provider";
import { haversineKm, transitTimeHours } from "./geo";

const A = { lat: 52.72, lon: -1.36, whId: "A" }; // Coalville-ish
const B = { lat: 51.5, lon: -0.12, whId: "B" }; // London-ish

// 2026-01-05 is a Monday (UTC dow=1), 2026-01-06 a Tuesday (dow=2).
const MON_09 = Date.UTC(2026, 0, 5, 9, 0, 0);
const MON_14 = Date.UTC(2026, 0, 5, 14, 0, 0);
const TUE_09 = Date.UTC(2026, 0, 6, 9, 0, 0);

function row(over: Partial<LaneTimeRow> & Pick<LaneTimeRow, "day_of_week" | "hour_of_day">): LaneTimeRow {
  return {
    from_warehouse_id: "A",
    to_warehouse_id: "B",
    p50_duration_minutes: 120,
    ...over,
  };
}

describe("makeTravelHours", () => {
  it("returns the exact lane+dow+hour p50", () => {
    const fn = makeTravelHours([row({ day_of_week: 1, hour_of_day: 9, p50_duration_minutes: 180 })]);
    expect(fn(A, B, MON_09)).toBeCloseTo(3); // 180 min = 3h
  });

  it("falls back to the same day-of-week average when the exact hour is missing", () => {
    // Monday has 08:00 and 10:00 samples (both 180) but no 09:00; Tuesday is faster.
    const fn = makeTravelHours([
      row({ day_of_week: 1, hour_of_day: 8, p50_duration_minutes: 180 }),
      row({ day_of_week: 1, hour_of_day: 10, p50_duration_minutes: 180 }),
      row({ day_of_week: 2, hour_of_day: 9, p50_duration_minutes: 120 }),
    ]);
    // Must use the Monday average (180 → 3h), NOT blend in Tuesday.
    expect(fn(A, B, MON_09)).toBeCloseTo(3);
  });

  it("falls back to the all-days lane average when that day-of-week has no samples", () => {
    const fn = makeTravelHours([
      row({ day_of_week: 2, hour_of_day: 9, p50_duration_minutes: 120 }),
      row({ day_of_week: 2, hour_of_day: 10, p50_duration_minutes: 120 }),
    ]);
    // Monday query: no Monday rows → lane average across all rows (120 → 2h).
    expect(fn(A, B, MON_09)).toBeCloseTo(2);
  });

  it("falls back to the distance model when there are no lane rows", () => {
    const fn = makeTravelHours([]);
    const expected = transitTimeHours(haversineKm(A.lat, A.lon, B.lat, B.lon));
    expect(fn(A, B, MON_09)).toBeCloseTo(expected);
  });

  it("reacts upward when the recent window is busier and has enough samples", () => {
    const fn = makeTravelHours([
      row({
        day_of_week: 1,
        hour_of_day: 9,
        p50_duration_minutes: 120,
        recent_p50_duration_minutes: 180,
        recent_sample_count: 6,
      }),
    ]);
    expect(fn(A, B, MON_09)).toBeCloseTo(3); // adopts the recent 180, not the 120 baseline
  });

  it("ignores the recent window when it has too few samples", () => {
    const fn = makeTravelHours([
      row({
        day_of_week: 1,
        hour_of_day: 9,
        p50_duration_minutes: 120,
        recent_p50_duration_minutes: 180,
        recent_sample_count: 3,
      }),
    ]);
    expect(fn(A, B, MON_09)).toBeCloseTo(2); // sticks with the stable baseline
  });

  it("does not drop the planned time on a few fast recent runs", () => {
    const fn = makeTravelHours([
      row({
        day_of_week: 1,
        hour_of_day: 9,
        p50_duration_minutes: 120,
        recent_p50_duration_minutes: 90,
        recent_sample_count: 8,
      }),
    ]);
    expect(fn(A, B, MON_09)).toBeCloseTo(2); // stays at baseline (max of base vs recent)
  });

  it("is deterministic for identical inputs", () => {
    const rows = [row({ day_of_week: 1, hour_of_day: 9, p50_duration_minutes: 150 })];
    const fn = makeTravelHours(rows);
    expect(fn(A, B, MON_09)).toBe(fn(A, B, MON_09));
    expect(fn(A, B, MON_14)).toBeCloseTo(fn(A, B, TUE_09)); // both fall back to lane avg (150)
  });
});
