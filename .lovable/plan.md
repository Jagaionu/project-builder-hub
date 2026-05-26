## Goal
Align runtime behavior with the right-hand column of your diagram. Six targeted fixes — no new UI surface, no schema changes beyond what's already in place.

---

## 1. Kill the auto-planner trigger
**File:** `src/lib/dispatch/use-auto-planner.ts` + caller in `src/routes/_app.dispatch.tsx`

Today `useAutoPlanner` runs whenever `plan` / `jobs` / `stopsMap` change, which re-assigns drivers on every data tick.

Change: the hook stops self-firing. Export a `runPlan()` callback instead of running inside a `useEffect`. The dispatch toolbar's existing **Plan** button calls `runPlan()`. No assignment happens until the user presses it.

## 2. Assign → `ASSIGNED`, never `IN_PROGRESS`
**File:** `src/lib/dispatch/use-auto-planner.ts` (the `assignDriver` call path)

Today the planner writes `status: "IN_PROGRESS"` when it assigns. That's wrong — `IN_PROGRESS` should only come from the driver actually starting the job (first leg start event).

Change: planner writes `status: "ASSIGNED"` + `planned_driver_id` + `assigned_driver_id`. The driver app's existing leg-start flow remains the only path that moves a job to `IN_PROGRESS`.

## 3. Remove the "normalize" effect that resets jobs to PENDING
**File:** likely `src/routes/_app.dispatch.tsx` or `src/lib/dispatch/*` — I'll grep for the offending effect

There's an effect that "normalizes" job status and pushes `ASSIGNED` rows back to `PENDING` when it doesn't see the expected shape. Delete it. The DB is the source of truth; the UI should not rewrite status client-side.

## 4. Tabs reflect DB reality
**File:** `src/routes/_app.dispatch.tsx` (status filter + counts)

Once #2 and #3 are fixed, the ASSIGNED tab will naturally have rows. I'll also double-check `statusCounts` groups by the raw DB `status` (not a derived/effective status) so a freshly-assigned job shows under ASSIGNED, not IN_PROGRESS.

## 5. GPS: `setInterval(5 min)` instead of `watchPosition`
**File:** `src/lib/driver-gps.ts` + caller in `src/hooks/useDriverBootstrap.ts` (or wherever `watchPosition` is wired)

Replace `navigator.geolocation.watchPosition` with a `setInterval` (default 5 min, configurable constant) that calls `getCurrentPosition` once per tick and pushes the ping to the existing `driver_events` / `drivers.current_lat/lon` writer. Reduces battery drain + DB write pressure.

Cleanup on unmount + tab-hidden pause (use `document.visibilityState`).

## 6. "Closest driver" assignment uses latest GPS
**File:** `src/lib/planner.ts` (or wherever `computePlan` picks a driver)

When `runPlan()` fires:
- For each unassigned job's first pickup, sort drivers by haversine distance from their `drivers.current_lat/lon`.
- Filter out drivers whose remaining shift hours can't cover `jobTotalMinutes` (already in `src/lib/geo.ts`).
- Pick the closest eligible driver.
- If that driver still has hours after this job, the planner is allowed to chain the next geographically-closest job onto them in the same run.

---

## Out of scope (explicitly)
- No new tables, no migration.
- No change to the parked-imports / Alerts flow we just shipped.
- No change to the driver-side job lifecycle (`IN_PROGRESS` → `ARRIVED_PICKUP` → ...).
- No new Plan button UI — the existing one in the dispatch toolbar gets wired to `runPlan()`.

## Verification
- Import a CSV → jobs land in PENDING, ASSIGNED tab stays 0, no driver assigned.
- Press Plan → drivers get assigned, jobs flip to ASSIGNED, ASSIGNED tab populates.
- Driver starts a leg in driver app → that one job flips to IN_PROGRESS; others stay ASSIGNED.
- Refresh page → no status churn (normalize effect is gone).
- Driver app: GPS ping logs once every ~5 min, not every few seconds.

Approve and I'll implement all six in one pass.