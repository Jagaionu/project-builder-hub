## Goal
When importing lanes, instead of silently skipping rows that reference unknown warehouse codes, **park them** so they appear in Alerts. Once the missing warehouse is created, the parked row is automatically promoted to a real `PENDING` job.

## Why
Today `importJobsCsv` returns `skippedUnknownWh` in the result toast only — the info is lost the moment the dialog closes. Planners have no durable list of "blocked imports" and have to re-upload the CSV after fixing warehouses.

---

## 1. New table: `pending_job_imports`

Holds the raw import row until all referenced warehouse codes exist.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid | RLS scope |
| `reference` | text | Load # |
| `lane` | text | original `BZDN->SWA->CDG8` string |
| `equipment_type` | text null | |
| `stop_scheduled_at` | timestamptz[] | per-stop arrivals |
| `missing_codes` | text[] | which WH codes are unknown |
| `created_at` / `updated_at` | timestamptz | |

RLS: standard `tenant_id = current_tenant_id()` select/insert/update/delete + `is_super_admin()` override. Unique `(tenant_id, reference)` so re-uploading the same Load # doesn't duplicate.

## 2. Import behavior change (`src/lib/jobs-import.functions.ts`)

Replace the `skippedUnknownWh` early-`continue` with an **upsert into `pending_job_imports`**. Result type gains `parked: string[]` (Load #s parked) alongside the existing `skippedUnknownWh` (kept for the toast detail).

Duplicate guard: if `reference` already exists in `jobs` OR in `pending_job_imports`, treat as duplicate.

## 3. Auto-promotion trigger

Postgres trigger on `warehouses` AFTER INSERT: for every `pending_job_imports` row in the same tenant whose `missing_codes` contains the new code, re-resolve all codes in `lane`. If all now resolve, the trigger:
- inserts a `jobs` row + `job_stops` rows (mirroring the import handler)
- deletes the `pending_job_imports` row

If some codes still missing, just update `missing_codes` to the remaining set.

Implemented as a `SECURITY DEFINER` plpgsql function so it can write across tables under RLS.

## 4. Alerts surface (`src/lib/use-alerts.ts`)

Add a new hook `useParkedImports()` that subscribes to `pending_job_imports` for the tenant. For each row, emit:

```
level: "warning"
type:  "Unmapped lane"
message: "{reference}: lane {lane} — missing {missing_codes.join(", ")}. Add the warehouse to release."
```

These flow through the existing `useAlerts()` pipeline, so they appear in the bell count, on `/alerts`, and respect the existing ack mechanism.

## 5. Out of scope
- No UI for manually editing a parked row's lane (planner fixes the warehouse, not the lane).
- No bulk-clear button on `/alerts` for parked imports (ack is enough; row disappears when promoted).
- No change to `csv-import.ts` parser — it already yields the row shape we need.

---

## Technical notes
- The trigger function reuses the same `(seq, kind, warehouse_id, scheduled_at)` mapping as `importJobsCsv` so promoted jobs are indistinguishable from directly-imported ones.
- `for_date` continues to be set by the existing `sync_job_for_date` trigger after stops are inserted.
- Realtime: enable `pending_job_imports` in `supabase_realtime` so the alerts hook updates without polling.
