## Goal
Make the tomorrow planner show real assignments, not just calculated ones, so routes stop appearing as Pending when the planner says they were assigned.

## What I found
- The planner is currently reporting the **computed** result (`plan.planned.length`) as “assigned”.
- In the database right now, tomorrow has **115 jobs**, **0 persisted `planned_driver_id`**, and all **115 are still `PENDING`**.
- The dispatch UI counts Pending from raw `job.status`, so even a planned route can still appear in Pending unless we explicitly treat planned jobs as scheduled/assigned.
- The server function updates jobs in a loop but **ignores update errors**, so it can claim success even if nothing was saved.

## Plan
1. **Harden tomorrow-plan persistence**
   - Update `planTomorrow` so each save is checked.
   - Collect failed job saves and return both:
     - computed assignments
     - successfully persisted assignments
   - Log the exact save failures instead of silently swallowing them.

2. **Make the UI reflect planned routes correctly**
   - Change the dispatch counters/list logic so jobs with `planned_driver_id` are not treated as plain Pending.
   - Show them consistently as planned/scheduled in the queue and in the top summary.
   - Keep manual assignments and active assignments unchanged.

3. **Reconcile tomorrow counts from one source of truth**
   - Use the same tomorrow dataset and status classification for:
     - the planner summary
     - Pending/Assigned boxes
     - the tomorrow coverage banner
   - This removes cases where the banner says routes are assigned but the status boxes still say Pending.

4. **Verify with live data**
   - Re-run the planner.
   - Confirm persisted `planned_driver_id` rows exist.
   - Confirm the Pending count drops and planned routes show in the correct bucket.

## Technical details
- Primary files:
  - `src/lib/tomorrow.functions.ts`
  - `src/routes/_app.dispatch.tsx`
- Likely code changes:
  - add explicit error handling around job update persistence
  - return persisted-vs-failed counts from the server function
  - derive a display status for tomorrow planned jobs based on `planned_driver_id` / `planned_start_at`
  - update status-box counting to use that derived display state instead of raw DB status alone