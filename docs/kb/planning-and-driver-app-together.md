# How Planning and the Driver App Work Together

This is the core of The Prime Route and the reason it pays for itself: you bring in your routes, the planner turns them into an optimised day for each driver, the driver app executes them, and the live progress flows straight back to dispatch — a closed loop.

## The end-to-end flow

1. **Get the routes in.** You receive routes (VRIDs/lanes) from your customer. **Bulk upload** them on the Dispatch tab via **Import CSV** (both the standard column format and the **FMC block export** are supported — for FMC, only rows with status **PLANNED** are imported, and equipment type, estimated cost and each stop's yard arrival/departure times come across automatically). You can also add routes by hand. Each route arrives as a **PENDING** job: a chain of warehouse stops, scheduled times, an optional equipment type and a service date.

2. **Plan.** You press **Planning**. Using each route's stops/times/equipment and each driver's **position, shift, holidays, hours, home depot, return-to-base and equipment**, plus warehouse coordinates and real road times, the planner assigns every route to the **closest eligible driver** and sequences their whole day — never breaking HGV hours (9h/day, 56h/week, 90h/fortnight, 45-min breaks), shift windows or equipment rules. Routes become **ASSIGNED** with a planned start and order; anything that can't be covered is listed with a reason.

3. **Drive.** Each driver opens the **driver app**, signs in with their **App code**, and sees only **their** routes for the day. As they drive, GPS confirms arrivals at each stop automatically, the route moves to **In Progress**, and at the final drop they tap **Confirm unloaded** to complete it.

4. **Feedback loop.** The driver's 5-minute GPS pings and events (arrived, unloaded, can't-complete, notes) flow back to the **Live Map**, the **dispatch board**, and the driver's **hours ledger** — so the next time you press Planning, it re-optimises from where everyone actually is and how many hours they have left. If a driver hits **Can't complete**, that route returns to PENDING for re-planning.

## Why this matters (the value)

- **Bulk in, optimised out:** drop in a whole day's customer routes and get a legal, distance-efficient plan per driver in one click — instead of assigning by hand.
- **Rules built in:** UK/EU driving hours, breaks, shifts, holidays, return-to-base and vehicle/equipment suitability are enforced automatically, reducing compliance risk.
- **One live picture:** the same routes you planned are what drivers execute and what you watch progress on the Live Map — no separate spreadsheets or phone calls.
- **Self-correcting:** because positions, hours and completions feed back in, re-planning during the day reflects reality.

## Quick reference

- **Inputs:** routes (stops, scheduled times, equipment, date) + drivers (position, shift, holidays, hours, home depot, equipment) + warehouses (coordinates) + real road times.
- **Engine:** assign each route to the nearest eligible driver, chain their day, enforce hours/breaks/shift/return-to-base/equipment, optimise with a regret-2 insertion + local-search pass.
- **Outputs:** per-driver routes with planned start/sequence; unassignable routes with reasons.
- **Execution:** driver app shows assigned routes; GPS auto-confirms arrivals; Confirm unloaded completes.
- **Loop:** GPS + events update Live Map, board and hours, feeding the next plan.
