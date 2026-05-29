-- ============================================================
-- MIGRATION #7: Close the last tenant-isolation gap (jobs.tenant_id)
--               + add the one missing composite index.
--
-- DO NOT RUN UNTIL REVIEWED.
-- Prerequisites: Migrations #1-#6 applied.
--
-- CONTEXT — what the post-#6 review asked for vs. what is already done.
-- A senior review of the *original* schema snapshot listed a "remaining 30%".
-- After auditing the live migrations, almost all of it is already in place:
--
--   ALREADY PRESENT — UNIQUE constraints (do NOT re-add):
--     • driver_day_hours (driver_id, day)            — base schema
--     • driver_availability_overrides (driver_id,date)— base schema
--     • job_stops (job_id, seq)                      — base schema
--     • company_members (company_id, user_id)        — multi_tenant_auth
--     • driver_daily_compliance (driver_id, date)    — migration #4
--     • route_jobs (route_id, stop_sequence)         — migration #4
--     • lane_travel_times (...) NULLS NOT DISTINCT   — migration #4
--     • warehouse_dwell_profiles (...) NULLS NOT DIST— migration #4
--     • warehouse_hours (warehouse_id, day_of_week)  — migration #4
--     • driver_shift_templates (driver_id,dow,start) — migration #3
--
--   ALREADY PRESENT — indexes (do NOT re-add):
--     • driver_positions (tenant_id, driver_id, created_at DESC) — #1
--     • driver_events    (tenant_id, driver_id, timestamp)       — #1
--     • jobs (tenant_id, status, for_date) WHERE deleted_at NULL — #4
--     • jobs (tenant_id, status, for_date, planned_sequence)     — #1
--     • route_jobs (route_id, stop_sequence)                     — #4
--     • lane_travel_times lookup, planning_queue unprocessed,    — #4
--       routes (tenant_id,route_date), routes (tenant_id,status) — #4
--
--   ALREADY PRESENT — NOT NULL tenant_id flips (migration #6):
--     drivers, driver_events, driver_availability_overrides,
--     driver_day_hours, driver_positions, driving_legs, stop_dwells,
--     job_stops, driver_shift_templates.
--
-- GENUINELY OUTSTANDING (this migration):
--   1. jobs.tenant_id is still NULLABLE. Jobs are never global, so a NULL
--      tenant_id is a silent-data-loss hole under tenant-scoped RLS. Flip it
--      to NOT NULL (guarded).
--   2. Add the one composite index the review wanted that we don't have:
--      routes (tenant_id, route_date, status) for the "routes for a tenant on
--      a date in a given status" planner query.
--
-- DELIBERATELY NOT CHANGED (the review didn't know the design):
--   • warehouses.tenant_id stays NULLABLE. tenant_id IS NULL means a GLOBAL
--     (shared) warehouse — a real, used feature:
--       - unique index warehouses_global_code_unique WHERE tenant_id IS NULL
--       - RLS "warehouse_select" exposes global rows to every tenant
--       - plan-jobs / jobs-import load `tenant_id = X OR tenant_id IS NULL`
--     Forcing NOT NULL would break global warehouses. Left intentionally.
--   • lane_travel_times.tenant_id and warehouse_dwell_profiles.tenant_id stay
--     NULLABLE for the same reason (NULL = global/cross-tenant statistics).
--     There is NO leak of tenant-private data: their SELECT policy allows
--     `tenant_id = current_tenant_id() OR tenant_id IS NULL`, and their MUTATE
--     policy requires `tenant_id = current_tenant_id()`, so a tenant can never
--     write a global row or read another tenant's private overrides.
--
--   • driver_positions partitioning is handled separately in migration #8
--     (it is an operational, maintenance-window change — not data integrity).
-- ============================================================

-- ── 1. jobs.tenant_id → NOT NULL (guarded) ─────────────────────────────────
DO $$
DECLARE
  v_null bigint;
  rec    record;
BEGIN
  SELECT count(*) INTO v_null FROM public.jobs WHERE tenant_id IS NULL;

  IF v_null > 0 THEN
    RAISE WARNING 'Migration #7: % jobs have NULL tenant_id. First 50 offending IDs:', v_null;
    FOR rec IN
      SELECT id, reference, status FROM public.jobs WHERE tenant_id IS NULL LIMIT 50
    LOOP
      RAISE WARNING '   job % (ref %, status %) has NULL tenant_id', rec.id, rec.reference, rec.status;
    END LOOP;
    RAISE EXCEPTION
      'Migration #7 aborted: public.jobs still has % NULL tenant_id rows. '
      'These are orphans invisible to tenant queries — assign a tenant or '
      'soft-delete them, then re-run.', v_null;
  END IF;
END $$;

ALTER TABLE public.jobs ALTER COLUMN tenant_id SET NOT NULL;

-- ── 2. Composite index for date+status route lookups ──────────────────────
CREATE INDEX IF NOT EXISTS idx_routes_tenant_date_status
  ON public.routes (tenant_id, route_date, status)
  WHERE deleted_at IS NULL;

-- ── 3. Sanity log — confirm the "already present" items really are present.
-- Non-fatal: prints a NOTICE for anything unexpectedly missing so a reviewer
-- can spot drift between environments. (Uses index/constraint existence only.)
DO $$
DECLARE
  v_missing text := '';
  v_idx     text;
  v_expected text[] := ARRAY[
    'idx_driver_positions_tenant_driver_time',
    'idx_driver_events_tenant_driver_time',
    'idx_jobs_planning',
    'idx_jobs_active',
    'idx_route_jobs_route',
    'idx_lane_travel_times_lookup',
    'idx_planning_queue_unprocessed'
  ];
BEGIN
  FOREACH v_idx IN ARRAY v_expected LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = v_idx
    ) THEN
      v_missing := v_missing || ' ' || v_idx;
    END IF;
  END LOOP;

  IF length(v_missing) > 0 THEN
    RAISE NOTICE 'Migration #7: expected indexes missing (investigate):%', v_missing;
  ELSE
    RAISE NOTICE 'Migration #7: all expected indexes present. jobs.tenant_id is now NOT NULL.';
  END IF;
END $$;
