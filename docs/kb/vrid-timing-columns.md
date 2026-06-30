# Dispatch stop times: Planned Yard, Planned Dock (CPT/CIT) and Estimated

On the Dispatch detail panel each stop of a VRID shows three time columns:
**Planned Yard**, **Planned Dock**, and **Estimated**. They describe different
moments in the stop and are derived from the VRID's critical time plus the
stop's handling (loading/unloading) time.

## The model

Every stop has a **critical time** (the time committed when the VRID was
created/imported) and a **handling time** (the minutes needed to load or unload,
default 20). From those two values the panel derives the yard and dock times.

- For a **pickup**, the critical time is the **CPT (Critical Pull Time)** — the
  latest the loaded trailer must pull away from the pickup.
- For a **drop**, the critical time is the **CIT (Critical Injection Time)** —
  the latest the trailer must arrive at the drop.

## Planned Yard

The time the trailer must physically be **in the yard** at that stop.

- **Pickup:** `Planned Yard = CPT − handling`. Example: CPT 17:00 with 20 min
  loading means the trailer must be in the yard by **16:40**, so loading is
  finished before the critical pull.
- **Drop:** `Planned Yard = CIT` — the trailer must arrive by the injection time.
- **Imported (FMC) routes:** the yard arrival time supplied on the VRID is used
  directly.

## Planned Dock (CPT / CIT)

The **critical contractual time** from the VRID, labelled **CPT** on pickups and
**CIT** on drops.

- **CPT (pickup):** the latest the loaded trailer must depart. The gap between
  Planned Yard and Planned Dock on a pickup is exactly the **loading window**
  (the handling minutes).
- **CIT (drop):** the latest the trailer must arrive / be injected.
- **Imported (FMC) routes:** this shows the yard departure time given on the
  VRID, with no CPT/CIT label.

## Estimated

The **live or actual time from the driver's GPS** — what is really happening,
versus the plan.

- A **pickup** shows the real **pull (departure)** once it happens; before that,
  a live yard-arrival estimate.
- A **drop** shows the real **arrival**.
- The live estimate only appears within **60 minutes** of the Planned Yard time
  or once the driver is en route; before that it shows a muted `from HH:MM`
  placeholder (a live ETA earlier than that is misleading because the driver may
  run another job first).
- It refreshes on every GPS update, so it sharpens as the run nears. Once the
  driver has arrived or departed, it shows the **real GPS time** — amber with
  `+Nm late` if behind the plan.
- A small badge shows how the time was captured: **GPS** (driver's device),
  **SYSTEM** (auto-filled at the planned time when no GPS arrival was captured),
  or inferred passage of an earlier stop.

## Quick example (pickup, CPT 17:00, 20 min handling)

- Planned Yard **16:40** — be in the yard, start loading.
- Planned Dock **17:00 CPT** — loaded and pulling away.
- Estimated **16:52 GPS** — the driver actually pulled at 16:52 (8 min early).
