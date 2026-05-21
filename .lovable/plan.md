## Goal
Restore access to the **Drivers** tab by fixing the render crash in the shared app area and validating the Drivers route end-to-end.

## Plan
1. **Fix the shared route crash in Jobs**
   - Repair the `ImportCsvButton` issue in `src/routes/_app.jobs.tsx` so the component is defined in the same render scope where it is used.
   - Re-check related imports and component structure to ensure the Jobs route no longer throws during render.

2. **Re-verify shared app shell and Drivers route**
   - Confirm the `_app` layout and child route setup are intact.
   - Verify `src/routes/_app.drivers.tsx` renders without throwing once the shared crash is removed.

3. **Validate in preview**
   - Open `/drivers` in the preview and confirm the page renders instead of the error fallback.
   - Check that the driver list, registrations section, and compliance cells load from the existing backend requests.

## Technical details
- The current evidence shows the Drivers data requests succeed, so this is not a backend/read-access problem.
- The strongest failure signal is a render-time `ReferenceError: ImportCsvButton is not defined` coming from `JobsPage`, inside the shared `_app` route tree.
- I’ll keep the fix tightly scoped to the crash and avoid changing the driver-hours logic unless a second Drivers-specific error appears after the shared render issue is cleared.