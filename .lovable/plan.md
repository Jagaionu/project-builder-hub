## Goal

On the Jobs page, allow a planner to remove (unassign) the driver from a job at any status, so they can manually intervene. Make sure the auto-planner doesn't immediately re-assign the same driver right after.

## Current behavior

- `DriverPicker` already supports an "Unassigned" option, but on `_app.jobs.tsx` line 727 it's disabled for active statuses:
  `allowUnassign={!ACTIVE_JOB_STATUSES.has(j.status)}` (ASSIGNED, IN_PROGRESS, ARRIVED_PICKUP, EN_ROUTE_DELIVERY).
- `assignDriver(jobId, "")` already clears `assigned_driver_id` and resets status to `PENDING`.
- The auto-planner effect re-runs on every change and would immediately re-assign the closest driver — undoing the manual action.

## Changes

### 1. `src/routes/_app.jobs.tsx`
- Always allow unassign in the driver picker: `allowUnassign={true}` (or just drop the prop, the default is true).
- Wrap the unassign action in a small confirm (`window.confirm("Remove driver from this job?")`) only when the job is in an active status, to avoid an accidental click reverting a live job to PENDING.
- When unassigning an active job, also set `manual_override = true` (see below) so the auto-planner doesn't immediately re-assign.
- In the auto-planner effect, skip both Pass 1 (immediate) and Pass 2 (planned) for any job where `manual_override = true`. Manually picking a driver again (or assigning via the picker) clears the override.

### 2. Database — add manual override flag

Migration to add a column on `jobs`:

```sql
ALTER TABLE public.jobs
  ADD COLUMN manual_override boolean NOT NULL DEFAULT false;
```

Semantics:
- `false` (default): auto-planner is free to assign/plan this job.
- `true`: planner has manually intervened — auto-planner leaves `assigned_driver_id`, `planned_driver_id`, `planned_sequence`, `planned_start_at` alone.

Set to `true` when the user unassigns a driver via the picker. Set back to `false` only when the user picks a specific driver from the picker (explicit manual assign also counts as manual intent, but they've now resolved it themselves; we keep it `true` so the planner doesn't override their pick either — they can re-enable auto by toggling, see optional step 3).

### 3. Optional: small "Auto" indicator (not required to ship)

If desired, show a tiny "manual" chip next to the driver cell when `manual_override = true`, with a click to clear it. Skipping unless you want it.

## Out of scope

- Driver-side notification on unassign (Telegram). Not currently sent on auto-assign either; can be added later if needed.
- Bulk unassign / unassign from the dispatch page.
