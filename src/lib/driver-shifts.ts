// Helpers for reading / writing driver weekly availability on top of the
// normalized driver_shift_templates table (one row per day, with start/end
// times and split-shift support).
//
// The planner and dispatch UI still reason about availability as a simple
// set of working weekdays (days_of_week). These helpers translate between
// that aggregate view and the per-day template rows, so callers don't need
// to know the storage shape.
//
// Works with either the anon `supabase` client or the service-role
// `supabaseAdmin` client — both expose the same `.from()` query builder.

import type { DriverShift, DriverShiftTemplate } from "@/lib/types";

// Minimal structural type for the bits of the Supabase client we use here.
// Avoids coupling to the specific generated client type so the same helper
// works for both browser and server clients.
type AnySupabase = {
  from: (table: string) => any;
};

const DEFAULT_START = "06:00:00";
const DEFAULT_END = "18:00:00";

/**
 * Fetch per-day shift templates for the given drivers and aggregate them into
 * the DriverShift shape (one entry per driver with a days_of_week set and
 * a shiftByDay map of per-day start/end times).
 *
 * A driver with no template rows is simply absent from the result — the
 * planner treats "no shift record" as an open schedule (available) and
 * falls back to DEFAULT_START/DEFAULT_END.
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
      // Overwrite shiftByDay for this day (uq_driver_day guarantees one row
      // per driver/day after migration #19, but handle duplicates gracefully
      // by keeping the is_primary row, or the latest by updated_at).
      const prev = existing.shiftByDay[row.day_of_week];
      if (
        !prev ||
        (row.is_primary && !prev) ||
        row.updated_at > existing.updated_at
      ) {
        existing.shiftByDay[row.day_of_week] = {
          start_time: row.start_time,
          end_time: row.end_time,
        };
      }
      // Keep the most recent updated_at across the driver's rows.
      if (row.updated_at > existing.updated_at) existing.updated_at = row.updated_at;
    } else {
      byDriver[row.driver_id] = {
        id: row.driver_id, // synthetic — the aggregate has no single row id
        driver_id: row.driver_id,
        days_of_week: [row.day_of_week],
        shiftByDay: {
          [row.day_of_week]: {
            start_time: row.start_time,
            end_time: row.end_time,
          },
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
export async function fetchShiftDays(
  client: AnySupabase,
  driverId: string,
): Promise<number[]> {
  const map = await fetchShiftsByDriver(client, [driverId]);
  return map[driverId]?.days_of_week ?? [];
}

/**
 * Replace a driver's weekly working-day pattern.
 *
 * Strategy: delete the driver's existing primary template rows, then insert
 * one row per selected weekday using default start/end times. Existing custom
 * times are intentionally reset to defaults here because the current UI only
 * captures day selection — a future time-aware editor can write richer rows.
 *
 * tenant_id is filled by the sync_tenant_from_driver() DB trigger if omitted,
 * but we pass it when known to avoid relying solely on the trigger.
 */
export async function saveShiftDays(
  client: AnySupabase,
  driverId: string,
  days: number[],
  tenantId?: string | null,
): Promise<void> {
  const unique = Array.from(new Set(days)).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);

  // Clear the driver's existing pattern, then re-insert. Simpler and more
  // predictable than diffing, and the row count per driver is tiny (<= 7).
  await client.from("driver_shift_templates").delete().eq("driver_id", driverId);

  if (unique.length === 0) return;

  const rows = unique.map((day) => ({
    driver_id: driverId,
    day_of_week: day,
    start_time: DEFAULT_START,
    end_time: DEFAULT_END,
    is_primary: true,
    ...(tenantId ? { tenant_id: tenantId } : {}),
  }));

  await client.from("driver_shift_templates").insert(rows);
}

export type ShiftPatternDay = { day_of_week: number; start_time: string; end_time: string };

/**
 * Fetch a single driver's full shift pattern — both the list of working
 * weekdays and the per-day start/end times. Used by the shift time editor
 * UI to initialise its state.
 */
export async function fetchShiftPattern(
  client: AnySupabase,
  driverId: string,
): Promise<{ days_of_week: number[]; shiftByDay: Record<number, { start_time: string; end_time: string }> }> {
  const map = await fetchShiftsByDriver(client, [driverId]);
  const ds = map[driverId];
  if (!ds) return { days_of_week: [], shiftByDay: {} };
  return { days_of_week: ds.days_of_week, shiftByDay: ds.shiftByDay };
}

/**
 * Replace a driver's weekly shift pattern with per-day times.
 *
 * Same strategy as saveShiftDays — DELETE all existing rows, then INSERT new
 * rows. Unlike saveShiftDays, this function accepts per-day start/end times
 * so the UI can write real shift hours instead of hardcoded defaults.
 */
export async function saveShiftPattern(
  client: AnySupabase,
  driverId: string,
  pattern: ShiftPatternDay[],
  tenantId?: string | null,
): Promise<void> {
  // Validate: filter out rows with empty times, deduplicate by day_of_week
  const valid = pattern
    .filter((p) => p.start_time && p.end_time)
    .filter(
      (p, i, arr) => arr.findIndex((x) => x.day_of_week === p.day_of_week) === i,
    );

  await client.from("driver_shift_templates").delete().eq("driver_id", driverId);

  if (valid.length === 0) return;

  const rows = valid.map((p) => ({
    driver_id: driverId,
    day_of_week: p.day_of_week,
    start_time: p.start_time,
    end_time: p.end_time,
    is_primary: true,
    ...(tenantId ? { tenant_id: tenantId } : {}),
  }));

  await client.from("driver_shift_templates").insert(rows);
}
