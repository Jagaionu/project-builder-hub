# How Planning Works

Planning is the heart of The Prime Route: you load the routes you need to run, press **Planning** on the Dispatch tab, and the app assigns each route to the best driver and builds each driver's day — respecting UK/EU HGV driving rules, shifts, holidays, vehicle/equipment needs and the road network. This page explains exactly what goes in, what the planner does, and what comes out.

## What goes in (the inputs)

The planner reads several things for the service day:

- **Routes (VRIDs / lanes)** that are **PENDING** and unassigned. Each route is a chain of stops between warehouses (e.g. `BHX1 -> LTN2 -> MAN1`); the first stop is the pickup and the last is the drop. A route also carries its **scheduled arrival time per stop**, an optional **equipment type**, an optional **estimated cost**, and the **service date** (`for_date`).
- **Drivers** — each driver's **live GPS position** (or their home depot if no GPS), their **weekly shift pattern** (which days, and start/end times), any **holidays / availability overrides**, their **home warehouse + "return to base"** setting, and the **equipment they're qualified to operate**.
- **Driver hours** — the real HGV hours each driver has already used, built from their recent driving history (the last 14 days), so caps are accurate.
- **Warehouses** — their coordinates, used for distances and ETAs.
- **Real road times** — historical lane travel times (by day-of-week and hour) are used when available, instead of straight-line estimates.

## What the planner does

For each service date it places routes onto drivers, one at a time (nearest-first, scheduled-pickup order), checking every rule below before it commits an assignment. It chains multiple routes onto the same driver across the day, projecting where and when each driver finishes before looking for their next pickup.

The rules it enforces for every candidate assignment:

- **Driving-hours limits (HGV):** a conservative **9 hours/day**, **56 hours/week**, and **90 hours/fortnight**. A driver is skipped if the route (plus the drive home, for return-to-base drivers) would break any cap.
- **Breaks:** a **45-minute break** is reserved for every **4.5 hours** of continuous driving.
- **Shift window:** the driver must be **working that day** (shift pattern, minus holidays) and able to **finish within their shift hours** (start *and* end time).
- **Distance sanity:** the first assignment uses drivers within ~**30 km** of the pickup; chained follow-on routes allow up to ~**80 km** from where the driver's previous run ends.
- **Scheduled times:** if a stop has a scheduled arrival, the planner won't assign a driver who'd have to drive faster than **100 km/h** to make it (an "impossible route").
- **Return to base:** if a driver must return to their home depot, the drive home is reserved in their hours budget and they must get home before shift end. A return leg is added to their day.
- **Equipment match:** if a route needs a specific equipment type, only drivers qualified for it are eligible (drivers with no equipment recorded are treated as unrestricted).
- **Compliance blocks:** drivers flagged by compliance (e.g. out of hours) are excluded.

Among all eligible drivers, the **closest** one wins (ties broken consistently so results are repeatable).

## What comes out (the outputs)

- Each assigned route becomes **ASSIGNED** to a driver, with a **planned start time** and a **sequence number** (its position in that driver's day).
- A **route** is saved per driver per day, including any **return-to-base** leg.
- Routes no driver can take are returned as **unassignable**, each with a plain-English reason (e.g. *"Closest: Sam — would exceed daily 9.4/9h"*, *"Equipment mismatch"*, *"can't return to base before shift end"*, *"No drivers available"*).
- Driver hours are refreshed immediately so the next plan is accurate.

## How do I run the planner?

On the **Dispatch** tab, press **Planning**. It re-plans all PENDING routes for their service dates. Re-running is safe: it first clears previous **auto-assignments** (it never touches routes a driver has already started, completed, or that you assigned manually), then re-optimises from the current positions and hours.

## What is "Audit Plan"?

Audit Plan is a **dry run** — it shows, per route, which driver would be chosen, or (if none) the **closest near-miss driver and the exact reason** they don't fit (hours, distance, shift end, equipment, scheduled time). Use it to understand and fix coverage gaps before committing.

## Why was a route not assigned?

The unassignable reason tells you which rule blocked it. Common causes: no driver on shift that day, every nearby driver out of hours, the route needs equipment nobody has, the scheduled pickup is impossible to reach in time, or a return-to-base driver couldn't get home before shift end. Fixes: add/relieve drivers' hours, adjust shifts/holidays, set driver equipment, set warehouse coordinates correctly, or relax the schedule.

## What if a route has no service date?

A route with no `for_date` can't be planned (the planner needs to know the service day). Set the date on the route, then re-plan.
