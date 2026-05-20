## Goal

1. Click any row in `/jobs` to **edit or delete** the lane.
2. Build routes with **N stops** (pickup/drop, in any order you like) — not just one origin + one destination.
3. The driver dropdown shows **every driver in the system** (already does — confirmed `Ionut` is the only one because earlier you said remove dummies). I'll keep it as-is and add an "Add driver" shortcut on the Drivers page.

## Schema

New table `job_stops`:

- `job_id` (fk → jobs, cascade delete)
- `seq` integer (0,1,2,…)
- `kind` enum `stop_kind` = `PICKUP` | `DROP`
- `warehouse_id` (fk → warehouses)
- `scheduled_at` timestamptz, nullable
- `arrived_at` timestamptz, nullable (filled by geofence)
- public-all RLS to match the rest of the app

Backfill: every existing job gets two rows (PICKUP at `origin_warehouse_id` seq=0, DROP at `destination_warehouse_id` seq=1). The `origin_warehouse_id` / `destination_warehouse_id` columns on `jobs` stay (nullable from now on) for safety — the app reads from `job_stops`.

## UI — `src/routes/_app.jobs.tsx`

- Row click opens an **Edit Route** modal (same form as Create) with **Delete** in the footer.
- "Route" column shows the full chain, e.g. `BHX1 → BHX5 → BHX2`.
- The route editor has a stop list with **+ Add stop** / remove / reorder, each row = kind selector (Pickup/Drop) + warehouse select + optional scheduled time.
- Driver dropdown unchanged — lists all drivers.

## Telegram job card

`buildJobCard` walks the ordered stops:

- Leg 0: driver location → stop 1 (transit time, ETA clock)
- 30 min loading at each PICKUP
- Leg N: stop N → stop N+1 (transit time)
- Final line: total drive + loading time, ETA clock at last stop.

Each stop shows its code, name, address and a Google Maps link.

## Bot geofence

Webhook tracks the **next stop without `arrived_at`** for the active job. When the driver is inside that warehouse's geofence:

- mark `arrived_at`
- if it's a PICKUP → status `ARRIVED_PICKUP`, prompt "tap 🚚 Picked up when loaded"
- if it's a DROP and not last → status `EN_ROUTE_DELIVERY` after driver taps Picked up, ETA recalculated to the following stop
- if it's the last stop → job `COMPLETED`, driver `AVAILABLE`

## Out of scope

- Drag-to-reorder stops (use up/down buttons instead — simpler, ships now)
- Per-stop time windows (only single `scheduled_at` per stop)
- Editing a route mid-shift after the driver has already accepted (allowed but no special "notify driver of changes" flow beyond the existing `notifyDriverOfJob` re-push)
