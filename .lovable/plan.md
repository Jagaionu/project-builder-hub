# Make `for_date` = first stop's scheduled arrival

The route's date should come from the **first stop's scheduled arrival**, not from the creation date or the job's `scheduled_at`. This applies to both the manual create form and the CSV import.

## What's already done

A database trigger (`sync_job_for_date`) is now installed on `job_stops`. After any insert/update/delete of stops, it recomputes the parent job's `for_date` as `MIN(stop.scheduled_at)::date`. Existing routes have been backfilled.

This alone fixes the underlying bug: from now on, every route — manual, CSV, Telegram, future code paths — will have the correct `for_date` automatically.

## Code changes to apply on approval

1. **`src/lib/jobs-import.functions.ts`** — remove the explicit `for_date: firstScheduled.slice(0,10)` from the job insert payload. The trigger handles it, so we drop the duplicate logic.

2. **`src/routes/_app.jobs.tsx`** (create/edit job form) — no change needed to the insert payload itself; the trigger will set `for_date` once stops are inserted. Small UX improvement: after save, if the computed first-stop date is tomorrow, show a toast *"Route scheduled for tomorrow — click Plan Tomorrow to assign a driver"*.

That's it — no other files touched.

## Why your job didn't get planned

- Today is 2026-05-21. Your new route had `for_date = today`, so "Plan Tomorrow" (which targets 2026-05-22) never saw it.
- Even if it had targeted today, Ionut is `OFF_SHIFT`. The live auto-planner only picks AVAILABLE / ON_SHIFT / ON_ROUTE drivers — off-shift is intentionally skipped.

After this change, the route's date will reflect its first stop. To assign Ionut, the first stop must be on 2026-05-22 and you click **Plan Tomorrow**.
