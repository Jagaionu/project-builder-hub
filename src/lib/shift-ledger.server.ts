// Daily driver shift hours ledger.
// One row per (driver, UK calendar day) in `driver_day_hours`. Re-derived from
// `driver_events` so the event log stays the source of truth and any
// correction (delete a bad event, run recompute) just works.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { legMinutes, haversineKm, transitTimeHours, type StopLike, type WhLike } from "@/lib/geo";

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
  const segWindows: Array<{ start: number; end: number }> = [];
  for (const s of segs) {
    const a = Math.max(s.start, start);
    const b = Math.min(s.end, dayEndCap);
    if (b > a) {
      shiftMs += b - a;
      segWindows.push({ start: a, end: b });
    }
  }
  const shiftMinutes = Math.round(shiftMs / 60_000);

  // Drive minutes = sum of TRANSIT minutes for legs of jobs this driver
  // worked, whose transit window overlaps a shift segment in this day.
  // Excludes loading/unloading/checks dwell and idle time between jobs.
  // Planned driving for the day from the warehouse chain (computeChainDriveMinutes).
  // Sole source of truth for drive_minutes; GPS legs feed actual_driving_minutes /
  // deadhead_minutes via recomputeDayTotals instead.
  const driveMinutes = await computeChainDriveMinutes(driverId, day);

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

// Planned driving minutes for a driver on a UK service day, derived from the
// warehouse chain of that day's planned jobs (sorted by planner sequence):
//   start -> first pickup (approach) -> loaded inter-stop transit per job ->
//   inter-job deadhead -> return to base. Haversine + fixed-speed, deterministic.
async function computeChainDriveMinutes(driverId: string, day: string): Promise<number> {
  const { data: drv } = await supabaseAdmin
    .from("drivers")
    .select("current_lat,current_lon,home_warehouse_id,return_to_base_required")
    .eq("id", driverId)
    .maybeSingle();
  const d = drv as {
    current_lat: number | null;
    current_lon: number | null;
    home_warehouse_id: string | null;
    return_to_base_required: boolean | null;
  } | null;

  const { data: jobRows } = await supabaseAdmin
    .from("jobs")
    .select("id,planned_sequence,planned_start_at,scheduled_at,created_at")
    .eq("for_date", day)
    .or("assigned_driver_id.eq." + driverId + ",planned_driver_id.eq." + driverId)
    .neq("status", "CANCELLED" as never);
  const jobs = (jobRows ?? []) as Array<{
    id: string;
    planned_sequence: number | null;
    planned_start_at: string | null;
    scheduled_at: string | null;
    created_at: string | null;
  }>;
  if (jobs.length === 0) return 0;

  jobs.sort((a, b) => {
    const sa = a.planned_sequence ?? Number.MAX_SAFE_INTEGER;
    const sb = b.planned_sequence ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    const ta = a.planned_start_at ?? a.scheduled_at ?? a.created_at ?? "";
    const tb = b.planned_start_at ?? b.scheduled_at ?? b.created_at ?? "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  const jobIds = jobs.map((j) => j.id);
  const [{ data: stopRows }, { data: whRows }] = await Promise.all([
    supabaseAdmin.from("job_stops").select("job_id,seq,warehouse_id").in("job_id", jobIds).order("seq", { ascending: true }),
    supabaseAdmin.from("warehouses").select("id,latitude,longitude"),
  ]);
  const whById = new Map(((whRows ?? []) as WhLike[]).map((w) => [w.id, w]));
  const stopsByJob: Record<string, Array<{ seq: number; warehouse_id: string }>> = {};
  for (const r of (stopRows ?? []) as Array<{ job_id: string; seq: number; warehouse_id: string }>) {
    (stopsByJob[r.job_id] ||= []).push({ seq: r.seq, warehouse_id: r.warehouse_id });
  }

  const legMin = (from: WhLike | null | undefined, to: WhLike | null | undefined): number =>
    from && to ? transitTimeHours(haversineKm(from.latitude, from.longitude, to.latitude, to.longitude)) * 60 : 0;

  const home = d?.home_warehouse_id ? whById.get(d.home_warehouse_id) ?? null : null;
  let cursor: WhLike | null =
    home ?? (d?.current_lat != null && d?.current_lon != null ? { id: "", latitude: d.current_lat, longitude: d.current_lon } : null);

  let total = 0;
  for (const job of jobs) {
    const stops = (stopsByJob[job.id] ?? []).slice().sort((a, b) => a.seq - b.seq);
    if (stops.length === 0) continue;
    const firstWh = whById.get(stops[0].warehouse_id) ?? null;
    const lastWh = whById.get(stops[stops.length - 1].warehouse_id) ?? null;
    if (!firstWh) continue;
    if (cursor) total += legMin(cursor, firstWh);
    for (let i = 0; i < stops.length - 1; i++) {
      total += legMin(whById.get(stops[i].warehouse_id), whById.get(stops[i + 1].warehouse_id));
    }
    cursor = lastWh ?? firstWh;
  }
  if (d?.return_to_base_required && home && cursor) total += legMin(cursor, home);

  return Math.round(total);
}

// Sum transit minutes (excluding dwell + buffer-as-dwell? — buffer is approach
// driving, so it stays in transit) for legs of jobs assigned to this driver
// whose midpoint falls inside the [dayStart, dayEnd] window AND inside one of
// the driver's shift segments on that day.
async function computeDriveMinutesForDay(
  driverId: string,
  dayStart: number,
  dayEnd: number,
  segWindows: Array<{ start: number; end: number }>,
): Promise<number> {
  if (segWindows.length === 0) return 0;

  // Pull jobs touched by this driver. We pad the window because a job that
  // started late yesterday may have legs landing today.
  const { data: jobRows } = await supabaseAdmin
    .from("jobs")
    .select("id,status,planned_start_at,scheduled_at,assigned_driver_id,planned_driver_id")
    .or(`assigned_driver_id.eq.${driverId},planned_driver_id.eq.${driverId}`)
    .neq("status", "CANCELLED" as never);
  const jobs = (jobRows ?? []) as Array<{
    id: string;
    planned_start_at: string | null;
    scheduled_at: string | null;
  }>;
  if (jobs.length === 0) return 0;

  const jobIds = jobs.map((j) => j.id);
  const [{ data: stopRows }, { data: whRows }] = await Promise.all([
    supabaseAdmin
      .from("job_stops")
      .select("job_id,seq,kind,warehouse_id,arrived_at,scheduled_at")
      .in("job_id", jobIds)
      .order("seq", { ascending: true }),
    supabaseAdmin.from("warehouses").select("id,latitude,longitude"),
  ]);
  const warehouses = (whRows ?? []) as WhLike[];
  const stopsByJob: Record<string, Array<StopLike & { arrived_at: string | null; scheduled_at: string | null }>> = {};
  for (const r of (stopRows ?? []) as Array<{
    job_id: string;
    seq: number;
    kind: "PICKUP" | "DROP";
    warehouse_id: string;
    arrived_at: string | null;
    scheduled_at: string | null;
  }>) {
    (stopsByJob[r.job_id] ||= []).push({
      kind: r.kind,
      warehouse_id: r.warehouse_id,
      arrived_at: r.arrived_at,
      scheduled_at: r.scheduled_at,
    });
  }

  const inAnyShift = (ms: number) =>
    segWindows.some((w) => ms >= w.start && ms <= w.end);

  let drive = 0;
  for (const job of jobs) {
    const stops = stopsByJob[job.id];
    if (!stops || stops.length < 2) continue;
    const jobStartMs = job.planned_start_at
      ? new Date(job.planned_start_at).getTime()
      : job.scheduled_at
        ? new Date(job.scheduled_at).getTime()
        : stops[0].scheduled_at
          ? new Date(stops[0].scheduled_at).getTime()
          : stops[0].arrived_at
            ? new Date(stops[0].arrived_at).getTime()
            : NaN;
    if (!Number.isFinite(jobStartMs)) continue;

    let cursor = jobStartMs;
    for (let i = 0; i < stops.length - 1; i++) {
      const fromWh = warehouses.find((w) => w.id === stops[i].warehouse_id);
      const toWh = warehouses.find((w) => w.id === stops[i + 1].warehouse_id);
      if (!fromWh || !toWh) continue;
      const leg = legMinutes(stops[i], fromWh, toWh);
      // Dwell at FROM stop happens first, then transit.
      const departMs = stops[i].arrived_at
        ? new Date(stops[i].arrived_at as string).getTime() + leg.loadingMin * 60_000
        : cursor + leg.loadingMin * 60_000;
      const arriveMs = stops[i + 1].arrived_at
        ? new Date(stops[i + 1].arrived_at as string).getTime()
        : departMs + leg.transitMin * 60_000;
      const midMs = (departMs + arriveMs) / 2;
      cursor = arriveMs;
      if (midMs < dayStart || midMs > dayEnd) continue;
      if (!inAnyShift(midMs)) continue;
      drive += leg.transitMin;
    }
  }
  return drive;
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
