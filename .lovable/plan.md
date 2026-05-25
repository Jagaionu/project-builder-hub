## Why the app is slow

Investigating `src/lib/hooks.ts` and `src/routes/_app.dispatch.tsx` (1662 lines) turned up four compounding problems. Every page that uses these hooks pays the cost, which is why "all pages" feel slow — not just Dispatch.

1. **Unbounded table reads.** `useJobs` does `from("jobs").select("*")` with no date filter, and `useJobStops` does `from("job_stops").select(...)` for every stop ever created. As the project grows these queries return everything historical on every page load.
2. **Realtime full reloads.** `useJobStops` re-fetches the entire `job_stops` table on every single `postgres_changes` event. Each auto-planner write below fires one of these events, so a single planning pass triggers dozens of full-table reloads.
3. **Auto-planner feedback loop.** The effect at `_app.dispatch.tsx:343` writes `planned_driver_id/sequence/start_at` back to `jobs` for every job that drifts. Each write fires a realtime UPDATE → `useJobs` mutates state → the effect re-runs. The `planSigRef` guard helps but the loop still re-evaluates `computePlan` over **all** jobs on every change.
4. **`computePlan` over everything.** It runs on the full historical jobs array, not just today/future. Same for `jobsForPlanner`, the unassigned-active-job normalizer (`:307`), and the stop-times sweep.

DB health confirms the database itself is fine (low connections, 13.5 MB) — the bottleneck is the client.

## Plan

Scope changes to `src/lib/hooks.ts` and `src/routes/_app.dispatch.tsx`. No schema changes.

### 1. Scope job and stop reads to a recent window

In `useJobs`, accept an optional `{ sinceDays }` (default 14) and filter:
- `gte("created_at", since)` OR `gte("for_date", since)` (whichever covers both active and recent history).
Dispatch already filters by `dateRange` in UI — the cache just needs to cover that window plus tomorrow.

Add a new `useJobStops(jobIds: string[])` that filters with `.in("job_id", jobIds)` instead of reading the whole table.

### 2. Make `useJobStops` incremental

Replace the "reload everything on any change" handler with payload-based updates:
- INSERT → push into the right `job_id` bucket
- UPDATE → replace by `id`
- DELETE → filter out by `id`

Only fall back to a full reload if the payload is missing fields.

### 3. Tame the auto-planner

In `_app.dispatch.tsx:343`:
- Filter jobs to only those in the active window (today + tomorrow + any unassigned PENDING) before passing to `computePlan`.
- Add an `isWritingRef` guard so the effect won't re-enter while its own writes are in flight.
- Batch the planned-fields updates: collect rows that need changing and issue a single `upsert` instead of N awaited updates in a loop.
- Move the unassigned-active-job normalizer (`:307`) out of a jobs-dependent effect into a one-shot on mount (or run it at most once per minute via a ref timestamp).

### 4. Memoize `computePlan` input

`computePlan` currently depends on `jobs` identity, which changes on every realtime event. Pre-filter to the planner-relevant subset and memoize that subset so `computePlan` only re-runs when something it cares about actually changed.

### Out of scope (call out, don't fix here)

- `useDriverEventsByDriver` / `useDriverDayHours` already window to 14–21 days; leave them.
- Realtime channel naming uses `Math.random()` per mount which is fine but wastes a channel on Strict Mode double-invoke; only worth touching if problems persist after the above.
- Pagination/virtualization of the Dispatch table can come next if the list is still heavy after the data layer is fixed.

### Validation

1. Open Dispatch with the network tab; confirm initial load fires **one** `jobs` query and **one** `job_stops` query, both date-scoped.
2. Trigger "Plan Tomorrow"; confirm `job_stops` realtime events do NOT cause a full reload, and the planner effect doesn't re-fire after its own writes.
3. Navigate Dispatch → Drivers → Dispatch; confirm pages render from cache instantly (no flash) and no extra full-table reads happen.
