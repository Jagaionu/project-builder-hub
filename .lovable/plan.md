
## Goal

On the **planner's Drivers tab** (not the driver app), make the weekly shift editor compact and "drop-down" style, and show each day's shift times inside the calendar cell so the planner can read schedules at a glance.

Scope: planner only (`isPlanner === true`). The driver app (`/d/profile`) keeps its current expanded behavior.

## Changes

### 1. `src/components/driver/ShiftPatternEditor.tsx` — collapsible behavior

- Add `isPlanner?: boolean` prop (already passed from `ShiftCalendar`).
- Introduce an `expanded` local state. When `isPlanner`:
  - Default `expanded = false`. Render a compact one-line header: "Weekly Pattern · Mon–Fri 06:00–18:00" (summary derived from `selectedDays` + `times`), with a chevron toggle.
  - Clicking the header (or any day chip) sets `expanded = true` and reveals the day toggle row + per-day time rows + Save/Discard.
  - On successful `save()`, set `expanded = false` so the editor collapses back to the summary line.
  - Discard also collapses.
- Driver-app path (`!isPlanner`) keeps the current always-open layout — no behavior change.
- Reduce overall padding/spacing slightly for planner mode (smaller header, tighter rows) so the section is noticeably more compact.

### 2. `src/components/driver/ShiftCalendar.tsx` — per-cell shift times

- For each working-day cell, render the start time (e.g. `06:00`) as a small second line under the date number, pulled from `initialTimes[dayOfWeek]`.
  - Layout: date number on top (smaller), time string below in `text-[8px]` muted; cell stays `aspect-square` but content stacks via `flex-col`.
  - Only show time when `type === "working"` and a time exists for that weekday; "holiday" / "extra" / "off" cells keep current look.
  - Show `HH:MM` only (start time) to keep cells legible at current size; full `start–end` shown in `title` tooltip.
- No data-model changes — `initialTimes` is already fetched and available in `ShiftCalendar`; just pass it through `getDateStatus` / cell renderer.

### 3. No backend / schema changes

`driver_shift_templates` already stores per-day `start_time` / `end_time`; the save flow via `saveShiftPattern` is unchanged.

## Technical notes

- `cellClass` signature unchanged; the time line is appended as a second child inside the button.
- Summary string: if all selected days share the same start/end, render `"<DayRange> HH:MM–HH:MM"`; otherwise `"<N> days · varied"`.
- Driver-app file `src/routes/d.profile.tsx` and its `ShiftCalendar` usage stay as-is (renders with `isPlanner={false}`).

## Out of scope

- No changes to overrides (holiday/extra) flow.
- No changes to driver-app profile UI.
- No new fields (home warehouse, daily-hours cap) — those remain from prior unimplemented plan.
