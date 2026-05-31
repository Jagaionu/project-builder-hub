## Goal

A driver who has **no day scheduled today** in the calendar shows **OFF_SHIFT**. A driver who **is scheduled today** shows **AVAILABLE** — but only when they're idle (raw status is `OFF_SHIFT` or `AVAILABLE`). Anything else (ON_ROUTE, ARRIVED_PICKUP, EN_ROUTE_DELIVERY, DELAYED, etc.) passes through unchanged.

Display-layer only — no DB writes, no planner change.

## Resolution rules

For each driver, today's schedule is a tri-state:
- `scheduled` — override row for today says `available=true`, OR no override and today's weekday is in `driver_shift_templates.day_of_week`.
- `not_scheduled` — override says `available=false`, OR no override and today's weekday is NOT in the templates.
- `unknown` — hook hasn't loaded yet.

Override always wins over template.

## Changes

### 1. `src/lib/effective-status.ts`

```ts
export type ScheduleStatus = 'scheduled' | 'not_scheduled' | 'unknown';
```

Extend `effectiveDriverStatus(rawStatus, jobs, nowMs, schedule = 'unknown')`:
- Keep existing ON_ROUTE → ON_SHIFT downgrade when no job actually started.
- Then apply a **strict whitelist** only when `rawStatus` is `OFF_SHIFT` or `AVAILABLE`:
  - `schedule === 'not_scheduled'` → `"OFF_SHIFT"`
  - `schedule === 'scheduled'` → `"AVAILABLE"`
  - `schedule === 'unknown'` → return raw (backward compatible)
- Any other raw status (ARRIVED_PICKUP, EN_ROUTE_DELIVERY, DELAYED, IN_PROGRESS, etc.) → pass through untouched, regardless of schedule.

### 2. New hook `src/lib/use-driver-schedule.ts`

Returns `Record<driverId, ScheduleStatus>`.

- Single `Promise.all` initial fetch of:
  - `driver_shift_templates` where `day_of_week = todayWeekday`
  - `driver_availability_overrides` where `date = today`
  - Both filtered by current tenant via RLS; both filter `deleted_at IS NULL` defensively if the column exists on the table (skip the filter if it doesn't — schema check: `drivers` has it, the child tables don't, so this only matters when joining).
- Merge in one pass so there's **no intermediate flash** (template-only → override-applied).
- Two realtime channels (`driver_shift_templates`, `driver_availability_overrides`); cleanup unsubscribes BOTH on unmount via stored refs to avoid duplicate subscriptions on remount.
- Initial value before fetch resolves: every driver is `'unknown'` → UI shows raw status during the brief load window (accepted; documented).

### 3. Call sites

- `src/routes/_app.drivers.tsx` — use the hook, pass `schedule[d.id] ?? 'unknown'` into `effectiveDriverStatus`. Existing OFF_SHIFT / ON_SHIFT / ON_ROUTE filter buckets continue to work.
- `src/components/drivers/driver-detail-panel.tsx` — accept an optional `schedule?: ScheduleStatus` prop from the parent (drivers route). When absent, behaves as today.
- Other callers of `effectiveDriverStatus` keep working — new arg is optional with `'unknown'` default.

## Explicitly out of scope (documented, not bugs)

- **Partial-day shifts.** `driver_shift_templates` has `start_time`/`end_time`, but the calendar UI today only captures weekday selection. We treat "scheduled today" as a whole-day boolean; a 14:00 start won't mark the driver OFF_SHIFT at 09:00. Time-window awareness is a future change.
- **Loading flash.** During initial hook load (`'unknown'`), the badge shows raw status. No skeleton — the window is short and the next render corrects it.
- **Persisting to `drivers.status`.** This is purely a display projection; the DB column is unchanged.