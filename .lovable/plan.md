## Goal

From the dispatch detail panel of a selected VRID, jump to the Live Map page focused on **only the assigned driver and that job's route** (origin → destination warehouses). From the map, a button returns to the same VRID in dispatch.

## Changes

### 1. Live Map route (`src/routes/_app.index.tsx`)
- Add a `validateSearch` schema accepting `job?: string` (job id) and `from?: "dispatch"`.
- Read the search param. If `job` is set, resolve the `Job` from `useJobs()` and:
  - Auto-select its `assigned_driver_id` (or `planned_driver_id` as fallback).
  - Pass a `focusJobId` prop to `<LiveMap>` so it filters what's rendered.
- Show a sticky "← Back to VRID" button (top-left over the map, or in `PageHeader` right slot) that navigates to `/dispatch?job=<reference>` (uses existing dispatch deep-link param).
- Show a small "Focused on {reference}" chip with a "Clear focus" action that navigates to `/` (removes the param).

### 2. `src/components/LiveMap.tsx`
- Add optional prop `focusJobId?: string | null`.
- When `focusJobId` is set, compute:
  - The focused job and its stops (use `job_stops` via the same hook used by dispatch, or derive from `origin_warehouse_id` / `destination_warehouse_id` already on `Job`).
  - The focused driver id (`assigned_driver_id ?? planned_driver_id`).
- Filter rendered markers:
  - Drivers: only the focused driver.
  - Warehouses: only the warehouses appearing in that job's stops (origin + destination, plus any multi-stop legs if available).
- Draw a polyline between driver's current position → next stop → remaining stops (simple straight segments using existing `haversineKm`/leaflet polyline; no routing API).
- Auto-fitBounds to the focused driver + warehouses on focus change.
- When `focusJobId` becomes null, restore normal "show all" behavior.

### 3. `src/components/dispatch/detail-panel.tsx`
- Add a "View on Map" button near the top of the panel (next to the existing edit/pencil action).
- Disabled (with tooltip "Assign a driver first") when no `assigned_driver_id` AND no `planned_driver_id`.
- On click: `navigate({ to: "/", search: { job: job.id, from: "dispatch" } })`.

### 4. Wire-up notes
- Dispatch already supports `?job=<reference>` deep-link, so the "Back to VRID" button uses `job.reference` to round-trip back to the same selected job.
- No DB or schema changes. No new dependencies.

## Out of scope
- Real road routing (we draw straight polylines between stops; consistent with current app which has no routing engine).
- Persisting the focus across reloads beyond the URL param (URL is the source of truth).