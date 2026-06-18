# The Driver App

Drivers don't use the dispatch console — they use a separate, phone-friendly **driver app**. This is where the routes you plan actually get executed, and where the live positions and progress you see on the Live Map come from.

## How does a driver sign in?

The driver opens the driver app and enters their **App code** — the code you generate and share from the driver's profile (Drivers tab → open the driver → Contact information → App code → Copy / Share). Once signed in, their app comes online and starts sharing position.

## What does a driver see?

- A **home screen** with their name, a **status** (Available, On Shift, On Route, Off Shift or Delayed), a **connectivity** indicator (Connected / Offline), their **live GPS** state, and any **equipment** tags.
- **Active Routes** — the routes assigned to them for the day, each as a card.
- **Completed** routes, collapsed at the bottom.

The status is derived from real work: once they start a route it shows **On Route**; with assigned-but-not-started work it shows **On Shift**; so a driver is never wrongly stuck "Off Shift" mid-route.

## How does location tracking work?

The app reads GPS on a **battery-friendly 5-minute cadence** (and an extra reading whenever the app returns to the foreground) rather than constantly — that's the resolution dispatch needs without draining the phone. Those pings drive the driver's dot on the **Live Map** and feed the planner's "where is this driver now" for the next run.

## How does a driver run a route?

Opening a route shows the **reference (VRID)**, the **stop chain** (warehouse codes), the date and planned start time, and a **stop timeline**. The driver app shows **committed/real times only** — no live "press while driving" estimates, for safety.

1. **Arrivals are confirmed automatically** when the driver reaches each stop (GPS-confirmed). The first arrival moves the route to **In Progress**.
2. When the **last drop** is reached, a **Confirm unloaded** button appears; pressing it marks the route **Completed** and sets the driver back to **Available**.
3. **Can't complete** — if something goes wrong mid-route, the driver taps this; the route goes back to **PENDING** (so it can be re-planned to someone else) and the dispatcher is notified.
4. **Notes** — the driver can leave a note for the dispatcher at any time.

Each of these actions is logged as a driver event (arrived, unloaded, can't-complete, note), which is what updates the dispatch board, the Live Map, and the driver's hours.

## What statuses can a route be in?

`PENDING` (waiting to be planned) → `ASSIGNED` (planned to a driver) → `IN_PROGRESS` (driver started / first arrival) → in transit (`ARRIVED_PICKUP` / `EN_ROUTE_DELIVERY`) → `COMPLETED`. A route can also be `CANCELLED`.

## A driver says they can't see their route

Check: the route is **ASSIGNED to that driver** for **today**, the driver is **signed in** with a current App code, and their app is **online** (top of their home screen). If the code was regenerated, the old one stops working — share the new one.
