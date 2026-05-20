## Plan: Seed all Amazon UK sites into warehouses

Insert the full Amazon UK site list (~45 sites across Fulfillment Centres, Sortation Centres, and Delivery Stations) into the `warehouses` table so they all appear on the live map.

### Approach

1. **Deduplicate existing sites** — the DB already contains 8 seeded warehouses (MAN8, BHX2, EMA1, etc.). I'll insert only the new codes and skip any that already exist (using `ON CONFLICT (code) DO NOTHING`; will add a unique constraint on `code` if missing).
2. **Single batched INSERT** for all sites with `code`, `name` (City / Region), `address`, `latitude`, `longitude`.
3. **Map auto-updates** — `LiveMap` already renders all rows from the `warehouses` table, so no UI changes needed.

### Site categorization in `name` field

To keep the map readable, I'll prefix names with the site type:
- `FC — <City>` for Fulfillment Centres (BHX1–4, MAN1–3, LTN1/2/4, LCY2, EDI4, CWL1, LBA1/2, EMA1, MME2, BRS1)
- `SC — <City>` for Sortation Centres (BHX5/7/8, EMA2, LBA4, LCY8)
- `DS — <City>` for Delivery Stations (all D-prefixed codes)

### Data scope

~45 sites total from your list, covering England, Scotland, and Wales. Coordinates copied verbatim from your table (converted to signed decimals — west = negative longitude, east = positive).

### Out of scope

- No schema changes beyond adding a unique constraint on `warehouses.code` (needed for idempotent re-seeding).
- No icon/category styling on the map yet — all sites use the existing warehouse marker. Happy to add type-based colors as a follow-up if you want.

Ready to apply?