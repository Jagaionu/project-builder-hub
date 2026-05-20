## Goal

Extend auto-assignment so every PENDING job gets a planned driver, not just the ones a free driver can grab right now. When there are more jobs than drivers, chain follow-on jobs onto drivers who will finish their current run nearby and still have legal HGV hours left.

## How it works

### Pass 1 — Immediate assignment (already built)

For each PENDING job, on shift drivers within 30 km of the first PICKUP get the closest one, respecting HGV compliance. These become **hard assignments** (`assigned_driver_id` set, status `ASSIGNED`), shown in the current solid colour.

### Pass 2 — Planned chaining (new)

After Pass 1, walk the remaining unassigned PENDING jobs in `scheduled_at` order. For each driver, build a forecast of where and when they will finish their current chain:

- Start from the driver's current job's **last DROP** warehouse.
- Compute finish time = now + remaining drive time on current job + 30 min loading per remaining PICKUP.
- Track projected daily / weekly / fortnight driving hours via the same `compliance.ts` model, pretending each leg's drive time is added to the shift.

For each unassigned job, the best candidate is the driver whose projected end location is closest to the job's first PICKUP (≤30 km) AND whose projected hours after completing the new job stay inside legal limits (10 h daily, 56 h weekly, 90 h fortnight, plus 11 h rest before next shift). Pick the closest. Repeat — a driver can be chained 2, 3, N times until either the radius or the hours run out.

These are **planned assignments**, not hard ones. They show as a grey pill on the driver row and a grey badge on the job row ("planned: Ionut, after SNG1→BHX2").

### Pass 3 — Leftovers

Jobs that no driver can legally reach today stay PENDING and surface on the Alerts page as "Unassignable — needs extra driver or reschedule", with the closest near-miss driver listed (e.g. "Ionut: 42 km out of 30, or 9.8/10 h").

## Schema

New columns on `jobs`:

- `planned_driver_id uuid null` — soft assignment from Pass 2
- `planned_sequence int null` — 1 = first follow-on, 2 = second, etc., per driver
- `planned_start_at timestamptz null` — forecast pickup time

No new tables. Hard assignment still uses `assigned_driver_id`.

Re-plan triggers: a job is created/edited/cancelled, a driver's status changes, a stop's `arrived_at` is filled, or the manual "Re-optimise" button on Dispatch is pressed. All plans are wiped and rebuilt — cheap, deterministic, avoids stale chains.

## UI

- **Jobs page**: existing assigned-driver cell stays as-is. Add a second line "Planned: Ionut · 2nd run · ETA 14:20" in muted grey when only `planned_driver_id` is set.
- **Drivers page**: under the compliance pill, a small grey chip "Next: JOB-AB12 (BHX2→SNG3)" listing the chain in order.
- **Dispatch page**: "Re-optimise all" button; map shows planned legs as dashed grey lines from each driver's last DROP to their next planned PICKUP.
- **Alerts page**: "Unassignable jobs" group with the near-miss reason.

## Algorithm (technical)

```text
runPlanner(jobs, drivers, stops, warehouses, compliance):
  clear all planned_* on jobs
  pending = jobs.filter(PENDING and not assigned)

  # Pass 1: immediate (unchanged from current code)
  for job in pending sorted by scheduled_at:
    assignClosestEligible(job)

  # Pass 2: build per-driver forecast
  forecast = {}
  for d in drivers where on_shift or available:
    forecast[d.id] = projectEnd(d)   # {endLat, endLon, endTime, hoursUsed}

  unplanned = jobs.filter(PENDING and not assigned and not planned)
  for job in unplanned sorted by scheduled_at:
    best = null
    for d, f in forecast:
      dist = haversine(f.endLat/Lon, job.firstPickup)
      if dist > 30: continue
      legDrive = transitTimeHours(dist) + jobDriveHours(job)
      if !fitsHgv(f.hoursUsed + legDrive, restBefore=f.endTime): continue
      if !best or dist < best.dist: best = {d, dist, legDrive}
    if best:
      job.planned_driver_id = best.d.id
      job.planned_sequence  = ++seqOf[best.d.id]
      job.planned_start_at  = forecast[best.d.id].endTime + transit
      forecast[best.d.id] = advanceForecast(best)
```

`jobDriveHours(job)` sums haversine transit + 0.5 h loading per PICKUP through the stop list. `fitsHgv` reuses the caps in `compliance.ts` (daily 10, weekly 56, fortnight 90, plus the 11 h rest rule before the next shift if the projection crosses a rest boundary).

## Out of scope

- Real road distance (still haversine — fine for radius checks)
- Driver preferences / skills / vehicle type matching
- Multi-driver swap optimisation (no global cost solver; greedy by distance only)
- Auto-promotion of `planned_driver_id` to `assigned_driver_id` (dispatcher confirms manually in this iteration)
