// Builds the HGV driving-hours ledger (daily / weekly / fortnightly) for drivers
// from the materialized driver_day_hours actuals, so the planner enforces REAL
// remaining capacity instead of assuming everyone starts fresh (the phantom-0
// compliance bug).
//
// Returns LedgerTotals (in HOURS) keyed by driver_id, ready to pass straight
// into computeCompliance(events, nowMs, ledger[driverId]).
//
// Works with the anon `supabase` client or the service-role `supabaseAdmin`
// client (worker) — both expose the same `.from()` builder.

import type { LedgerTotals } from "@/lib/compliance";

type AnySupabase = { from: (table: string) => any };

type DayHoursRow = {
  driver_id: string;
  day: string; // YYYY-MM-DD
  drive_minutes: number | null;
  actual_driving_minutes: number | null;
  deadhead_minutes: number | null;
};

// What counts as "driving" for the HGV limits: time at the wheel, loaded AND
// empty. If your data already folds empty running into drive_minutes, change
// this to `r.drive_minutes ?? 0`.
const drivingMinutes = (r: DayHoursRow): number => r.drive_minutes ?? 0;

const utcDateStr = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * daily  = driving on today's (UTC) date
 * weekly = driving over the trailing 7 days (incl. today)
 * twoWeek = driving over the trailing 14 days (incl. today)
 * continuousDrive is left to the planner (it can't be derived from day rollups).
 */
export async function buildHoursLedger(
  client: AnySupabase,
  driverIds: string[],
  nowMs: number = Date.now(),
): Promise<Record<string, LedgerTotals>> {
  const out: Record<string, LedgerTotals> = {};
  if (driverIds.length === 0) return out;
  for (const did of driverIds) out[did] = { daily: 0, weekly: 0, twoWeek: 0 };

  const today = utcDateStr(nowMs);
  const weekAgo = utcDateStr(nowMs - 6 * 86_400_000);
  const twoWeekAgo = utcDateStr(nowMs - 13 * 86_400_000);

  const { data } = await client
    .from("driver_day_hours")
    .select("driver_id, day, drive_minutes, actual_driving_minutes, deadhead_minutes")
    .in("driver_id", driverIds)
    .gte("day", twoWeekAgo);

  for (const r of (data ?? []) as DayHoursRow[]) {
    const t = out[r.driver_id] ?? (out[r.driver_id] = { daily: 0, weekly: 0, twoWeek: 0 });
    const h = drivingMinutes(r) / 60;
    t.twoWeek! += h; // query is already bounded to the 14-day window
    if (r.day >= weekAgo) t.weekly! += h;
    if (r.day === today) t.daily! += h;
  }

  return out;
}
