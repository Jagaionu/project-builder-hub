# Warehouses

Warehouses are the locations (sites) your routes run between. Open the **Warehouses** tab to manage them.

## How do I add a new warehouse?

In the **Warehouses** tab, click **Add Warehouse**, then fill in:
- **Code** (e.g. BHX2)
- **Name** (e.g. Birmingham Hub)
- **Latitude** and **Longitude** (the map coordinates)
- **Address** (optional)

Save it and the warehouse appears in the list and on the map.

## How do I update a warehouse address?

Open the **Warehouses** tab, find the warehouse, click **Edit**, change the **Address** field, and save.

## How do I change the name of a warehouse?

Open the **Warehouses** tab, click **Edit** on the warehouse, change the **Name** field, and save.

## How do I change the code of a warehouse?

Open the **Warehouses** tab, **Edit** the warehouse, and update the **Code** field (e.g. BHX2), then save. The code is the short identifier used on routes and the dispatch board.

## What does the Warehouses tab contain?

It lists all your company's warehouses with their code, name, and location, plus a search box and an **Add Warehouse** button. Each row can be edited (code, name, address, latitude/longitude) or deleted. Global (shared) warehouses also appear but can't be edited or deleted by a company.

## How do I update the coordinates (latitude / longitude)?

Open the **Warehouses** tab, **Edit** the warehouse, and update the **Latitude** and **Longitude** fields, then save. Coordinates control where the warehouse appears on the map and are used for route planning and ETAs.

## Why can't I delete a global warehouse?

Global warehouses are shared locations created by the platform super admin and used across many companies, so a company admin or member cannot delete them — that's intentional, to avoid breaking other companies. You can only add, edit, and delete your **own company's** warehouses. If a global warehouse is wrong, raise a support case.

## Do warehouses count toward my plan limit?

Only your **own** company warehouses count toward the plan's warehouse limit. Global (shared) warehouses do not count.

## How do I search warehouses?

Use the search box in the Warehouses tab to filter by code, name, or address.


## How do I import warehouses from a CSV?

In the **Warehouses** tab, click **Import CSV** (top of the page, next to Export CSV and Add Warehouse) and choose your `.csv` file. Each row should have the warehouse **code**, **name**, **latitude**, **longitude**, and optional **address**. The app adds the new warehouses, skips duplicates (same code), and reports how many were imported, skipped, or invalid. This is the fastest way to add many of your own warehouses at once. (This is separate from importing **routes** — route/VRID imports are done from the **Dispatch** tab.)

## How do I export my warehouses to a CSV?

In the **Warehouses** tab, click **Export CSV** to download a CSV of your company's warehouses (code, name, latitude, longitude, address). Use it for a backup, to edit in a spreadsheet, or to re-import after changes. The button is disabled when you have no warehouses yet.

## What's the difference between importing warehouses and importing routes?

- **Import CSV on the Warehouses tab** adds **warehouse locations** (sites).
- **Import CSV on the Dispatch tab** adds **routes/VRIDs** (the daily jobs that run between warehouses).

They use different files and live on different tabs, so pick the tab that matches what you're loading.
