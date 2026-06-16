# Tachograph & Driver Hours

## What is the weekly tachograph request?

Each week the app asks every driver to log their **actual driving minutes** from their tachograph. The driver submits the real figure, which the app compares against its own estimate from the week's routes.

## How does a driver log their tachograph hours?

The driver opens the tachograph prompt in the driver app, enters their actual drive minutes (and optional break minutes/notes), and submits. The request status moves to "submitted".

## What is a discrepancy?

If the submitted driving time differs from the system estimate by more than the allowed tolerance, the request is flagged as a discrepancy for the dispatcher to review.

## What happens if a driver ignores the tachograph request?

It stays pending and the dispatcher can resend a reminder. The weekly request is created automatically by a scheduled job.

## Where do driver hours come from?

Driver day-hours are computed from the driver's routes (driving legs and stop dwells). Actual driving time is also informed by submitted tachograph figures, which can override the estimate for compliance checks.

## Why is a driver blocked by compliance?

If a driver is near or over their allowed driving/duty hours, the system flags them so they aren't over-assigned. Submitted tachograph hours feed this check.
