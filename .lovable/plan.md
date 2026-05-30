# Driver Schedule — Improvements

Two phases. Phase 1 ships standalone; Phase 2 builds on it.

## Phase 1 — Design polish (no DB, no behavior change)

**Files:** `src/styles.css`, `src/components/driver/ShiftCalendar.tsx`, `src/routes/d.profile.tsx`

1. **Replace inline `oklch()` styles with semantic tokens.** Add to `src/styles.css`:
   ```
   --shift-working, --shift-working-border, --shift-working-fg
   --shift-holiday, --shift-holiday-border, --shift-holiday-fg
   --shift-extra,   --shift-extra-border,   --shift-extra-fg
   --shift-off-fg
   --shift-today-ring
   ```
   Use them via Tailwind arbitrary classes (`bg-[var(--shift-working)]`) so the calendar inherits light/dark theme correctly.

2. **Strip all inline `style={{ background, color, borderColor, outline }}` blocks** from `ShiftCalendar` and replace with a small `cellClass(type, isToday)` helper that returns Tailwind classes.

3. **Dedupe instructions.** Remove the `INSTRUCTIONS` block + repeated paragraph from `d.profile.tsx`. Keep one short helper line above the weekday-pattern row inside `ShiftCalendar`.

4. **Single-row weekday header.** Drop the second `Mo Tu We…` row; reuse the same labels for the pattern row and the month grid.

5. **Better today indicator.** Solid 2px ring in `--shift-today-ring` + bold weight on the date number; remove the easy-to-miss outline-offset trick.

6. **Hover + keyboard focus states** on every date cell (`hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring`).

7. **Loading skeleton.** While the month overrides query is loading, show a 6×7 grid of muted rounded squares instead of empty cells.

8. **Legend cleanup.** Single inline row, smaller swatches, no wrap on the driver-detail panel width. Add `title` tooltips.

9. **"Today" shortcut + month label is clickable** to jump back to current month.

10. **Save Pattern → confirm + discard pair.** Show both buttons side by side only when `patternChanged`. "Discard" resets `selectedDays` to `savedDays`. Add a success toast on save.

## Phase 2 — Functionality (depends on Phase 1 tokens)

### 2a. Per-day split shifts (UI for existing `driver_shift_templates`)

Long-press (mobile) / right-click or click a small ⏱ badge (desktop) on a weekday in the **Weekly Pattern** row opens a popover with:
- One or more time intervals (start/end pickers, `<input type="time">` for simplicity).
- "Add interval" button (writes additional `driver_shift_templates` rows for that `day_of_week` with `is_primary=false`).
- "Remove interval" trashcan per row.

New helpers in `src/lib/driver-shifts.ts`:
- `fetchShiftIntervals(client, driverId)` → `Record<day_of_week, {id, start, end, isPrimary}[]>`
- `saveShiftIntervals(client, driverId, day, intervals[])` → deletes that day's rows, re-inserts with `is_primary=true` on the first, `false` on the rest.

Replace `saveShiftDays` callers with the interval-aware path; the existing "days only" toggle still works (writes a single default 06:00–18:00 interval, marked `is_primary=true`).

Render time chips inline on each weekday button when the user has non-default intervals (e.g. `Wed · 06–10, 14–18`).

### 2b. Planner override with audit log

Extend `driver_availability_overrides` with two columns:
- `overridden_by_user_id uuid null` — planner who flipped a driver-set row
- `overridden_at timestamptz null`

When `isPlanner=true` and an existing override has `set_by='driver'`, allow the toggle (currently blocked). On delete, instead of `DELETE`, do an `UPDATE` setting `set_by='planner'`, `overridden_by_user_id=auth.uid()`, `overridden_at=now()`. On the driver app, show a small "Changed by dispatch" badge on those days so the driver knows.

No new table — single migration just adds the two columns + a partial index. RLS already permits the write under existing `manage overrides` policy.

### 2c. Small quality wins

- **Past-date guard.** Disable date cells whose `dateStr < today` (no click handler, lower opacity). The cron rollover should handle history; manual editing of yesterday's availability is never intended.
- **Optimistic override toggle** with rollback on error; currently the UI mutates state only after `await`.
- **TanStack Query** for `['shift-overrides', driverId, year, month]` and `['shift-templates', driverId]` to dedupe the planner-panel + driver-app fetches and cache across month nav.
- **Realtime subscription** on `driver_availability_overrides` filtered by `driver_id` so planner and driver views stay in sync without a refresh.

## Out of scope

- Bulk date-range select / vacation picker — separate request if needed.
- Conflict warning against already-assigned jobs — separate request; needs cross-table read in the calendar.
- Push notification when planner overrides — separate.

## Technical notes

- Phase 1 touches presentation only. No new packages.
- Phase 2a writes multiple rows per `(driver_id, day_of_week)`; `fetchShiftsByDriver` already tolerates this (deduplicates into `days_of_week`). Planner availability logic in `src/lib/planner.ts` is unaffected.
- Phase 2b is a single additive migration:
  ```sql
  ALTER TABLE public.driver_availability_overrides
    ADD COLUMN overridden_by_user_id uuid,
    ADD COLUMN overridden_at timestamptz;
  ```
  No GRANT/RLS changes needed (columns inherit the table's policies).
- Time inputs use native `<input type="time">` — no datepicker dependency, works on mobile.
