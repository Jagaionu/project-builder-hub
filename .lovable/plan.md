## Problem

Right now compliance is computed on the fly from `driver_events` (START_SHIFT / END_SHIFT pairs) every time the UI renders. Two things go wrong:

1. **Rest-hours logic is broken.** When you start a fresh shift after a long break, the previous closed shift's `end` is still close to "now" only if there were recent phantom toggles, but in general the rule compares `openShiftStart − previousShiftEnd`. If anything has dirtied the events (duplicate START_SHIFTs from Telegram replays, a missing END_SHIFT, etc.), `restHours` ends up tiny and the badge stays on **breach** forever — even though you've actually been off for hours.
2. **No durable per-day / per-week ledger.** Weekly (56h) and 2-week (90h) totals are re-derived from raw events every render. There's nothing to inspect, nothing to correct, and no clean weekly reset.

You asked for a proper table per driver, keyed by date, that tracks on-shift / off-shift hours, and a clean weekly rollover.

## Plan

### 1. New table: `driver_day_hours`

One row per driver per UK calendar day.

```text
driver_day_hours
  id             uuid pk
  driver_id      uuid  → drivers.id
  day            date            -- UK local date (Europe/London)
  shift_minutes  int   default 0 -- total on-shift time that day
  drive_minutes  int   default 0 -- shift_minutes minus auto-deducted 45m / 4.5h
  off_minutes    int   default 0 -- 1440 − shift_minutes
  week_start     date            -- Monday of the ISO week (for weekly reset)
  updated_at     timestamptz
  unique(driver_id, day)
```

- `week_start` lets us aggregate the 56h weekly cap with a simple
  `sum(drive_minutes) where week_start = current_monday`.
- 2-week (90h) cap = sum over the last 14 days.
- "Cleared on new week" is implicit: once `week_start` changes, the weekly
  total naturally drops to 0 and grows from there. Old rows stay for audit
  and for the 2-week window; nothing is destroyed.

### 2. Recompute logic (single source of truth)

Add `src/lib/shift-ledger.server.ts` with one function:

```text
recomputeDriverDay(driverId, day)
  → reads driver_events for that day (+ a small overlap window)
  → folds START/END pairs into total shift minutes
  → applies the same 45m-per-4.5h break rule already in compliance.ts
  → upserts driver_day_hours for (driver_id, day)
```

Call sites (server-side only, via `supabaseAdmin`):
- Telegram webhook, right after inserting a `START_SHIFT` / `END_SHIFT` event.
- A small `/api/public/cron/shift-rollover` route that, at ~00:05 UK time, closes the previous day for any driver still on shift (splits the open segment at midnight, writes yesterday's row, leaves today's row growing). The user can call this from any cron service; no DB cron required.

### 3. Rewrite `computeCompliance` to read the ledger

`src/lib/compliance.ts` keeps the same exported `Compliance` shape, but the maths becomes:

- `daily` = today's `drive_minutes` from `driver_day_hours`.
- `weekly` = sum of `drive_minutes` for rows where `week_start = thisMonday`.
- `twoWeek` = sum of `drive_minutes` for rows where `day >= today − 13`.
- `onShift` / `restHours` / `continuousDrive` = derived from the **single most recent** START/END pair in `driver_events` (not the full history), so a fresh START_SHIFT after a real rest period correctly shows the gap.
- The 60-second phantom-segment filter stays as a belt-and-braces guard.

This fixes the "still showing breach after I just started" bug at the root: rest is measured from the immediately previous END_SHIFT, not from whatever the segment-builder happened to produce.

### 4. UI

- **Drivers page**: existing compliance badge keeps working (same shape).
- **Driver detail / compliance drawer**: add a small 14-day table:

```text
Date        On shift   Drive   Off
Mon 18/05   8h 12m     7h 27m  15h 48m
Tue 19/05   …
```

  Pulled from `driver_day_hours` so the user can see and trust the numbers that drive the breach calc.

### 5. Backfill

One-off script (run from the migration): for each driver, replay existing `driver_events` for the last 14 days through `recomputeDriverDay` so weekly/2-week totals are correct from day one.

## Technical notes

- Table is in `public`, RLS = `using (true) with check (true)` to match the rest of the schema; all writes go through server functions / webhook with `supabaseAdmin`.
- `week_start` computed as `date_trunc('week', day)::date` (Postgres ISO week, Monday-based) in a generated column or in the upsert payload — generated column is cleaner.
- No change to `driver_events` schema; it remains the append-only event log. The new table is a derived, queryable rollup.
- No new dependency, no edge function.

## Out of scope

- Changing the legal thresholds (still 10h daily / 56h weekly / 90h fortnightly / 9h rest).
- Manual edit UI for the ledger (read-only for now; we can add an admin override later if you want).
- Timezones other than Europe/London.
