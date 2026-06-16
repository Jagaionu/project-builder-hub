# Planning & CSV Import

## How do I run the planning algorithm?

On the Dispatch page click **Planning** (or "Run today's plan" in the AI assistant). The planner assigns pending unassigned routes to drivers based on availability, hours, and timing. Review the result before committing; mutating actions are proposed first and you confirm them.

## What does the planner consider?

Driver availability and shift schedule, driving-hours/compliance limits, warehouse locations and travel times, and route timing windows (CPT/CIT).

## How do I import routes from a CSV?

On the Dispatch page click **Import CSV**, choose your file, and review the parsed rows before importing. Imported routes are created as VRIDs.

## What date format does the import use?

Dates are read as **mm/dd/yyyy**. Only rows with status PLANNED are imported. The Estimated Cost column is captured and shown in the route's Edit dialog.

## Why are some CSV rows skipped?

Rows that aren't status PLANNED are filtered out by design, and rows with missing required fields (e.g. warehouse codes that don't match) can't be created — check the import preview for which rows were skipped and why.

## What is "Audit Plan"?

Audit Plan checks the current plan for problems (compliance, timing, unassigned work) so you can fix them before dispatching.
