# Estimated arrival time (the Estimated column)

The Estimated column on a run detail shows a live, dispatcher-only estimate of when the assigned driver will reach the next stop. Drivers do not see it; they see real planned and actual times.

## How it is calculated

It takes the driver current location from GPS, measures the distance to the next stop, and applies the transit-time model (city speed for the first stretch, motorway speed beyond) to get a drive time. The estimate is the current time plus that drive time. It recalculates on every GPS update, so it gets more accurate as the run approaches.

## When it appears

To avoid a misleading number, the live estimate only shows when it is meaningful:

- within 60 minutes of the planned yard time, or
- once the driver is actually en route (the run is in progress).

Before that window it shows from HH:MM, which is when the live estimate will start. This is intentional: if a driver is idle 10 minutes from the yard but the run is not due for hours, showing an early arrival would be wrong, because the driver may take another job first.

## After arrival

Once the driver actually arrives or departs a stop, the column switches to the real GPS time, marked with a GPS tag, and turns amber if it was later than the planned critical time.

## Related times

- Planned yard: when the driver should be at the yard.
- Planned dock: the critical time (CPT for a pickup, CIT for a drop).
- Estimated: the live or actual arrival described above.
