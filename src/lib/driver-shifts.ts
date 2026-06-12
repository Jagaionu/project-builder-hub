// Helpers for reading / writing driver weekly availability on top of the
// normalized driver_shift_templates table (one row per day, with OPTIONAL
// start/end times).
//
// The planner and dispatch UI reason about availability as a set of working
// weekdays (days_of_week). A working day may have a fixed time window OR no
// fixed hours at all (null start/end) — in the latter case the planner treats
// the driver as available that day with no shift-end cap (compliance only).
//
// Works with either the anon `supabase` client or the service-role
// `supabaseAdmin` client — both expose the same `.from()` query builder.

import type { DriverShift, DriverShiftTemplate } from "@/lib/types";

// Minimal structural type for the bits of the Supabase client we use here.
type AnySupabase = {
  from: (table: string) => any;
};

type DayTimes = { start_time: string | null; end_time: string | null };

/**
 * Fetch per-day shift templates for the given drivers and aggregate them into
 * the DriverShift shape (one entry per driver with a days_of_week set and a
 * shiftByDay map of per-day start/end times). Times may be null = no fixed
 * hours for that working day.
 *
 * A driver with no template rows is simply absent from the result — the
 * planner treats "no shift record" as an open schedule (available).
 */
export async function fetchShiftsByDriver(
  client: AnySupabase,
  driverIds: string[],
): Promise<Record<string, DriverShift>> {
  if (driverIds.length === 0) return {};

  const { data } = await client
    .from("driver_shift_templates")
    .select("*")
    .in("driver_id", driverIds);

  const rows = (data ?? []) as DriverShiftTemplate[];
  const byDriver: Record<string, DriverShift> = {};

  for (const row of rows) {
    const existing = byDriver[row.driver_id];
    if (existing) {
      if (!existing.days_of_week.includes(row.day_of_week)) {
        existing.days_of_week.push(row.day_of_week);
      }
      // uq_driver_day guarantees one row per driver/day, but handle duplicates
      // gracefully by keeping the latest by updated_at.
      const prev = existing.shiftByDay[row.day_of_week];
      if (!prev || row.updated_at > existing.updated_at) {
        existing.shiftByDay[row.day_of_week] = {
          start_time: row.start_time,
          end_time: row.end_time,
        };
      }
      if (row.updated_at > existing.updated_at) existing.updated_at = row.updated_at;
    } else {
      byDriver[row.driver_id] = {
        id: row.driver_id, // synthetic — the aggregate has no single row id
        driver_id: row.driver_id,
        days_of_week: [row.day_of_week],
        shiftByDay: {
          [row.day_of_week]: { start_time: row.start_time, end_time: row.end_time },
        },
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }
  }

  for (const ds of Object.values(byDriver)) {
    ds.days_of_week.sort((a, b) => a - b);
  }

  return byDriver;
}

/**
 * Fetch a single driver's working weekdays (sorted). Empty array = no pattern.
 */
export async function fetchShiftDays(client: AnySupabase, driverId: string): Promise<number[]> {
  const map = await fetchShiftsByDriver(client, [driverId]);
  return map[driverId]?.days_of_week ?? [];
}

/**
 * Replace a driver's weekly working-day pattern (days only, no fixed hours).
 *
 * Inserts one row per selected weekday with NULL times — i.e. "available that
 * day, hours unspecified". Use saveShiftPattern when per-day times are known.
 */
export async function saveShiftDays(
  client: AnySupabase,
  driverId: string,
  days: number[],
  tenantId?: string | null,
): Promise<void> {
  const unique = Array.from(new Set(days))
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b);

  await client.from("driver_shift_templates").delete().eq("driver_id", driverId);

  if (unique.length === 0) return;

  const rows = unique.map((day) => ({
    driver_id: driverId,
    day_of_week: day,
    start_time: null,
    end_time: null,
    is_primary: true,
    ...(tenantId ? { tenant_id: tenantId } : {}),
  }));

  await client.from("driver_shift_templates").insert(rows);
}

// A working day in the pattern. Times are OPTIONAL: null = no fixed hours.
export type ShiftPatternDay = {
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
};

/**
 * Fetch a single driver's full shift pattern — working weekdays plus per-day
 * times (which may be null). Used by the shift editor to initialise its state.
 */
export async function fetchShiftPattern(
  client: AnySupabase,
  driverId: string,
): Promise<{ days_of_week: number[]; shiftByDay: Record<number, DayTimes> }> {
  const map = await fetchShiftsByDriver(client, [driverId]);
  const ds = map[driverId];
  if (!ds) return { days_of_week: [], shiftByDay: {} };
  return { days_of_week: ds.days_of_week, shiftByDay: ds.shiftByDay };
}

/**
 * Replace a driver's weekly shift pattern.
 *
 * Strategy: DELETE all existing rows, then INSERT one row per selected day.
 * Times are optional — a day with null start/end is still saved as a working
 * day (days are compulsory, hours are not). Only the day_of_week is required
 * and de-duplicated; rows are never dropped for missing times.
 */
export async function saveShiftPattern(
  client: AnySupabase,
  driverId: string,
  pattern: ShiftPatternDay[],
  tenantId?: string | null,
): Promise<void> {
  const valid = pattern.filter(
    (p, i, arr) =>
      p.day_of_week >= 0 &&
      p.day_of_week <= 6 &&
      arr.findIndex((x) => x.day_of_week === p.day_of_week) === i,
  );

  await client.from("driver_shift_templates").delete().eq("driver_id", driverId);

  if (valid.length === 0) return;

  const rows = valid.map((p) => ({
    driver_id: driverId,
    day_of_week: p.day_of_week,
    start_time: p.start_time ?? null,
    end_time: p.end_time ?? null,
    is_primary: true,
    ...(tenantId ? { tenant_id: tenantId } : {}),
  }));

  await client.from("driver_shift_templates").insert(rows);
}
