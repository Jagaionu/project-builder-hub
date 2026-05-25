## Goal
When a job has a `planned_driver_id` (tomorrow's auto-planned routes), it must display as **Scheduled** with the planned driver shown as the assigned driver — matching image 2 — instead of the current "Pending / Unassigned — click to assign · planned: …" treatment.

Underlying DB stays the same: `planned_driver_id` remains separate from `assigned_driver_id`. This is a display-layer change only.

## Changes (display-only, `src/routes/_app.dispatch.tsx`)

### 1. Route list card (around lines 873–893)
Treat a job with `planned_driver_id` as effectively SCHEDULED and use the planned driver where the assigned driver would normally render:
- If `j.planned_driver_id` is set and there's no `assigned_driver_id`, set `effectiveStatus = "SCHEDULED"` and show `plannedDriver.name` in the list row instead of the unassigned placeholder.

### 2. Detail panel header status (around lines 1019–1030)
Same rule: if no assigned driver but `planned_driver_id` is present, `effectiveStatus = "SCHEDULED"`.

### 3. Detail panel "Assigned driver" block (lines 1149–1167)
When `!driver && job.planned_driver_id`:
- Replace the `DriverPicker` (which renders "Unassigned — click to assign") with the same avatar + name layout as the assigned-driver state (matches image 2).
- Keep the row clickable so the dispatcher can override the planned driver via the picker, but the default visual is the populated assigned-driver card, not the dashed unassigned placeholder.
- Remove the small "planned: Freddie Carter · #1 · 26 May, 07:00" chip in this case (it becomes redundant). Keep the chip only when there's a `planned` suggestion from the live planner that hasn't been persisted yet.

### 4. Suggested drivers block (line 1170)
Hide "Suggested drivers (closest first)" when `planned_driver_id` is set — the route already has a chosen driver, suggestions are noise. (Suggestions still show for truly unassigned jobs.)

## Out of scope
- No DB schema changes.
- No change to `planTomorrow` persistence logic.
- No change to status counts / coverage banner (already updated in the previous turn to bucket planned jobs as ASSIGNED).

## Verification
- Reload `/dispatch`, confirm tomorrow's planned routes render with the "Scheduled" badge in the list and show the planned driver name + avatar in both the list row and the detail panel's Assigned driver card.
- Confirm clicking the driver row still opens the picker so dispatchers can change the driver.
- Confirm jobs with neither assigned nor planned driver still show the "Unassigned — click to assign" state and the suggested-drivers table.
