# Logistics Platform Overview

## Dispatch board

The dispatch board shows all jobs (routes) for your company. Use the status filters to hide completed or cancelled jobs.

## CSV import

1. Click **Import CSV** on the dispatch toolbar.
2. Upload a file with columns: `Load #`, `Lane`, `Equipment Type`, and `Scheduled Truck Arrival - N date/time`.
3. Lane format uses warehouse codes separated by `->`, e.g. `BZDN->SWA_FR_GRAVUREE->CDG8`.
4. Rows with unknown warehouse codes are **parked** in Alerts until those warehouses exist.
5. Duplicate Load # values create a reimport alert instead of a second job.

## Planning

Click **Plan** to auto-assign all pending, unassigned jobs. The planner:

- Groups jobs by `for_date`
- Respects driver shifts and availability overrides
- Checks UK HGV compliance (daily/weekly hours, breaks)
- Sets status to ASSIGNED and fills planned stop times

Jobs with `manual_override` are never changed by auto-plan.

## Manual driver assignment

Select a job, pick a driver from the detail panel. Compliance breaches block assignment. Manual assignments set `manual_override` so the planner will not overwrite them.

## Troubleshooting

- **Job stuck in Pending:** Check `for_date` is set and warehouses in the lane exist.
- **Driver not available:** Check driver shift calendar and availability overrides.
- **Import parked:** Add missing warehouses under Warehouses, then promote from Alerts.
