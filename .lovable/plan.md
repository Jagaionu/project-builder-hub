## Findings
- **The crash is most likely not caused by missing driver rows.** I checked the backend and **both drivers are present** in the `drivers` table:
  - DM
  - Ionut
- The new `driver_day_hours` table currently has **2 rows for only 1 driver** (`Ionut`). `DM` has no hours rows yet.
- That missing hours data **should not crash the page by itself**, because the current compliance code already falls back to an empty array when a driver has no ledger rows.
- The strongest concrete failure signal is a **hydration mismatch** on the Drivers tab:
  - server rendered: `18:56:09`
  - client rendered: `5:56:09 PM`
- That points to **locale/time-format rendering inside the Drivers page**. The route is using `toLocaleTimeString()` / `toLocaleString()` directly, so the server and browser format the same timestamp differently. React then tears down and rebuilds the page, which matches the “loads for 1 sec then crashes” behavior.

## Plan
1. **Stabilize Drivers page rendering**
   - Replace locale-dependent time rendering on the Drivers route with a deterministic formatter shared by server and client.
   - Fix both the roster “Last Update” cell and the pending registrations “Submitted” cell.

2. **Verify the hours table path after the render fix**
   - Re-check the compliance section with one driver having ledger rows and one without.
   - Confirm the page stays mounted and that missing rows simply show normal fallback behavior instead of crashing.

3. **Optional cleanup path for driver data**
   - If you want, I can also remove the current driver records and their related hours/event records so you can re-add both cleanly.
   - I would do that in a controlled way so there are no orphaned rows left behind.

## Technical details
- Current driver count: **2**
- Current ledger count in `driver_day_hours`: **2**
- Distinct drivers represented in ledger: **1**
- Most likely root cause: **SSR/client time formatting mismatch**, not missing drivers

## Expected result after implementation
- Drivers tab should stop flashing/crashing.
- Both existing drivers should remain visible.
- The driver with no `driver_day_hours` rows should still load normally.
- If you choose cleanup afterward, I can then wipe and reinsert the driver data safely.