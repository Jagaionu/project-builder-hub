// Daily driver shift hours ledger.
// One row per (driver, UK calendar day) in `driver_day_hours`. Re-derived from
// `driver_events` so the event log stays the source of truth and any
// correction (delete a bad event, run recompute) just works.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { legMinutes, type StopLike, type WhLike } from "@/lib/geo";

const UK_TZ = "Europe/London";

// Returns "YYYY-MM-DD" for a Date in UK local time.
export function ukDayString(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: UK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// UTC ms boundaries [start, end) for a UK calendar day "YYYY-MM-DD".
function ukDayBoundsMs(day: string): { start: number; end: number } {
  // Compute the UTC instant of UK midnight by reading what the wall clock in UK
  // would be for a candidate UTC time, then shifting by the offset.
  const [y, m, d] = day.split("-").map(Number);
  // Guess noon UTC of that date as a starting point.
  const guess = Date.UTC(y, m - 1, d, 12, 0, 0);
  // Find what UK time that guess is, derive the UK→UTC offset, then back out
  // UK midnight in UTC. Iterating once handles DST safely.
  const ukNoonStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(guess));
  const [hh, mm] = ukNoonStr.split(":").map(Number);
  // UK wall noon minus actual wall time = offset
  const offsetMin = (12 - hh) * 60 - mm;
  const start = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMin * 60_000;
  return { start, end: start + 24 * 3600 * 1000 };
}

type ShiftEvent = { type: "START_SHIFT" | "END_SHIFT"; t: number };

// Build closed [start,end] segments from raw events, capped at `nowMs`.
// Merges adjacent segments with gap < MERGE_GAP_MS to absorb accidental
// END→START toggles. Drops any segment shorter than MIN_SEG_MS.
const MIN_SEG_MS = 5 * 60_000;       // 5 min
const MERGE_GAP_MS = 10 * 60_000;    // 10 min

function buildShiftSegments(
  events: ShiftEvent[],
  nowMs: number,
): Array<{ start: number; end: number; open: boolean }> {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const segs: Array<{ start: number; end: number; open: boolean }> = [];
  let openStart: number | null = null;
  for (const e of sorted) {
    if (e.type === "START_SHIFT") {
      if (openStart == null) openStart = e.t;
    } else if (openStart != null) {
      segs.push({ start: openStart, end: e.t, open: false });
      openStart = null;
    }
  }
  if (openStart != null) segs.push({ start: openStart, end: nowMs, open: true });

  // Merge close-then-quickly-open pairs (accidental bounces).
  const merged: typeof segs = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && s.start - prev.end <= MERGE_GAP_MS) {
      prev.end = s.end;
      prev.open = s.open;
    } else {
      merged.push({ ...s });
    }
  }
  return merged.filter((s) => s.open || s.end - s.start >= MIN_SEG_MS);
}

export async function getDriverShiftEvents(
  driverId: string,
  fromIso: string,
  toIso: string,
): Promise<ShiftEvent[]> {
  const { data } = await supabaseAdmin
    .from("driver_events")
    .select("type,timestamp")
    .eq("driver_id", driverId)
    .in("type", ["START_SHIFT", "END_SHIFT"] as never)
    .gte("timestamp", fromIso)
    .lte("timestamp", toIso)
    .order("timestamp", { ascending: true });
  return (data ?? []).map((r) => ({
    type: r.type as "START_SHIFT" | "END_SHIFT",
    t: new Date(r.timestamp as string).getTime(),
  }));
}

// Recompute the row for (driver, day). Day is "YYYY-MM-DD" in UK.
export async function recomputeDriverDay(driverId: string, day: string): Promise<void> {
  const { start, end } = ukDayBoundsMs(day);
  // Pull a wide window so we can resolve START/END pairs that straddle midnight.
  const windowFromIso = new Date(start - 36 * 3600_000).toISOString();
  const windowToIso = new Date(end + 36 * 3600_000).toISOString();
  const events = await getDriverShiftEvents(driverId, windowFromIso, windowToIso);
  const nowMs = Date.now();
  const segs = buildShiftSegments(events, nowMs);

  let shiftMs = 0;
  const dayEndCap = Math.min(end, nowMs);
  for (const s of segs) {
    const a = Math.max(s.start, start);
    const b = Math.min(s.end, dayEndCap);
    if (b > a) shiftMs += b - a;
  }
  const shiftMinutes = Math.round(shiftMs / 60_000);
  const driveHours = driveHoursOf(shiftMinutes / 60);
  const driveMinutes = Math.round(driveHours * 60);
  // Off only counts elapsed time within the day (so "today" doesn't show 24h
  // of off-shift at 6am).
  const elapsedMinInDay = Math.max(0, Math.round((dayEndCap - start) / 60_000));
  const offMinutes = Math.max(0, elapsedMinInDay - shiftMinutes);

  await supabaseAdmin
    .from("driver_day_hours")
    .upsert(
      {
        driver_id: driverId,
        day,
        shift_minutes: shiftMinutes,
        drive_minutes: driveMinutes,
        off_minutes: offMinutes,
      } as never,
      { onConflict: "driver_id,day" },
    );
}

// Recompute yesterday + today for one driver. Cheap; safe to call from the
// webhook after any START_SHIFT/END_SHIFT insert.
export async function recomputeRecent(driverId: string): Promise<void> {
  const now = new Date();
  const today = ukDayString(now);
  const yesterday = ukDayString(new Date(now.getTime() - 24 * 3600_000));
  await recomputeDriverDay(driverId, yesterday);
  if (today !== yesterday) await recomputeDriverDay(driverId, today);
}

// Backfill / nightly: recompute the last `days` days for every driver.
export async function recomputeAllRecent(days = 2): Promise<{ drivers: number; rows: number }> {
  const { data: drivers } = await supabaseAdmin.from("drivers").select("id");
  const list = (drivers ?? []) as Array<{ id: string }>;
  const now = new Date();
  let rows = 0;
  for (const d of list) {
    for (let i = 0; i < days; i++) {
      const day = ukDayString(new Date(now.getTime() - i * 24 * 3600_000));
      await recomputeDriverDay(d.id, day);
      rows++;
    }
  }
  return { drivers: list.length, rows };
}

// One-off backfill for the last `days` days (default 21 covers 2-week window
// plus buffer).
export async function backfillAll(days = 21): Promise<{ drivers: number; rows: number }> {
  return recomputeAllRecent(days);
}
