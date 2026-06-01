## Goal

Mirror the planner-side shift UI improvements on the **driver app** (`/d/profile`): a collapsible weekly shift editor and per-day shift times shown inside each calendar cell. Currently those behaviors are gated to `isPlanner === true`, so the driver app still shows the old always-open editor and time-less cells.

## Changes

### 1. `src/components/driver/ShiftPatternEditor.tsx` — collapsible for everyone
- Remove the `isPlanner` gate around the collapsible behavior. The compact summary header ("Mon–Fri · 06:00–18:00" + chevron) and auto-collapse-on-save/discard should apply in **both** planner and driver-app modes.
- Keep `isPlanner` only where it still matters semantically (e.g. wording, save toasts, padding if it differs). Default `expanded = false` in both modes.
- Driver-app touch targets: keep buttons/inputs at their current larger size for mobile; only the open/closed flow changes, not the input sizing when expanded.

### 2. `src/components/driver/ShiftCalendar.tsx` — per-cell times in driver app too
- The per-cell `HH:MM` rendering under the date number must run regardless of `isPlanner`. Currently the time line is only added in planner mode; extend it to the driver app cells as well.
- Cell layout stays `aspect-square`, content stacks via `flex-col`: date number on top, `text-[8px]` muted time below for `type === "working"` days. Holiday / extra / off cells unchanged.
- Full `start–end` remains in the `title` tooltip.

### 3. No backend / schema / data-flow changes
`fetchShiftPattern`, `saveShiftPattern`, overrides flow, and `driver_shift_templates` are unchanged. This is purely a UI parity change.

## Out of scope
- No changes to overrides (holiday/extra) UX.
- No changes to home warehouse / return-to-base card on `/d/profile`.
- No changes to the planner-side detail panel — it already has this behavior.
