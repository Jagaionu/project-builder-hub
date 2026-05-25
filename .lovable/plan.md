## Plan

1. Update the dispatch suggestions UI so each unassigned route only renders the 3 closest suggested drivers instead of 8.
2. Fix the tomorrow planner data load so shared warehouses are included when planning for a tenant, which should allow pickup locations to resolve and routes to be assigned.
3. Re-check the planner result end-to-end by confirming tomorrow jobs now receive `planned_driver_id` values and that the unassignable reasons change from the current false "No stops / pickup configured" failure.

## What I found

- The suggested drivers table already ranks drivers by distance correctly; it is currently slicing to 8, so reducing it to 3 is a very small UI change.
- Tomorrow planning currently sees:
  - 115 tomorrow jobs
  - 61 available drivers with valid start locations
  - 0 jobs with a planned or assigned driver
- The likely root cause is in `src/lib/tomorrow.functions.ts`: warehouse loading is filtered to the tenant only, but your warehouses are currently shared records with `tenant_id = null`.
- Because of that, the planner cannot resolve the pickup warehouse for tomorrow jobs, and it marks routes as unassignable even though the jobs do have stops.

## Technical details

- `src/routes/_app.dispatch.tsx`
  - Change the suggested-driver render from `ranked.slice(0, 8)` to `ranked.slice(0, 3)`.
- `src/lib/tomorrow.functions.ts`
  - Change the warehouse query so tenant planning includes both:
    - tenant-owned warehouses
    - shared warehouses where `tenant_id` is `null`
  - Keep the rest of the planning flow intact.
- Validation
  - Re-run the tomorrow planner.
  - Confirm planned counts increase above 0.
  - Confirm the previous unassignable reason is gone for normal jobs with valid stops.

## Expected outcome

- The route drawer becomes lighter/faster by showing only the top 3 closest drivers.
- Tomorrow planning should start assigning drivers again for eligible routes instead of returning 0.