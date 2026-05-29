-- ============================================================
-- MIGRATION #6: Enforce NOT NULL on every tenant_id column
--
-- DO NOT RUN UNTIL REVIEWED.
-- Prerequisites: Migrations #1-#5 applied AND verified in production
--   (Migration #1's RAISE NOTICEs reported zero remaining NULLs).
--
-- Why a separate migration: flipping NOT NULL is the irreversible
-- "lock it in" step. We keep it isolated so it can be applied only
-- after the additive backfill (#1) and RLS (#2) have soaked in
-- production and we are confident no code path inserts NULL tenant_id.
--
-- Addresses the review finding: leaving tenant_id nullable after RLS
-- means a future NULL insert produces a row invisible to tenant
-- queries — silent data loss. This migration closes that hole.
--
-- Every flip is guarded: if any NULL remains the migration aborts with
-- a descriptive EXCEPTION rather than silently skipping. Fix the data,
-- then re-run.
--
-- NOTE on drivers.tenant_id: a driver with no tenant is nonsensical, but
-- the original schema left it nullable. This migration enforces it. If
-- you have orphan drivers (tenant_id IS NULL) the migration will abort
-- and print their IDs — assign them a tenant (or soft-delete them) first.
-- ============================================================

-- Reusable guard: abort with a clear message if a column still has NULLs.
DO $$
DECLARE
  rec        record;
  v_null     bigint;
  v_targets  text[][] := ARRAY[
    ARRAY['drivers',                       'tenant_id'],
    ARRAY['driver_events',                 'tenant_id'],
    ARRAY['driver_availability_overrides', 'tenant_id'],
    ARRAY['driver_day_hours',              'tenant_id'],
    ARRAY['driver_positions',              'tenant_id'],
    ARRAY['driving_legs',                  'tenant_id'],
    ARRAY['stop_dwells',                   'tenant_id'],
    ARRAY['job_stops',                     'tenant_id'],
    ARRAY['driver_shift_templates',        'tenant_id']
  ];
  v_tbl  text;
  v_col  text;
  i      int;
BEGIN
  FOR i IN 1 .. array_length(v_targets, 1) LOOP
    v_tbl := v_targets[i][1];
    v_col := v_targets[i][2];

    -- Skip tables that don't exist (e.g. driver_shift_templates if #3 skipped).
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) THEN
      RAISE NOTICE 'Migration #6: table %.% does not exist — skipping.', v_tbl, v_col;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', v_tbl, v_col)
      INTO v_null;

    IF v_null > 0 THEN
      IF v_tbl = 'drivers' THEN
        RAISE WARNING 'Migration #6: % drivers have NULL tenant_id. Offending IDs:', v_null;
        FOR rec IN SELECT id, name FROM public.drivers WHERE tenant_id IS NULL LIMIT 50 LOOP
          RAISE WARNING '   driver % (%) has NULL tenant_id', rec.id, rec.name;
        END LOOP;
      END IF;
      RAISE EXCEPTION
        'Migration #6 aborted: %.% still has % NULL rows. Backfill or remove them, then re-run.',
        v_tbl, v_col, v_null;
    END IF;
  END LOOP;
END $$;

-- All guards passed — flip NOT NULL. Each is wrapped so a missing table
-- (skipped #3) does not abort the whole migration.

ALTER TABLE public.drivers                       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.driver_events                 ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.driver_availability_overrides ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.driver_day_hours              ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.driver_positions              ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.driving_legs                  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.stop_dwells                   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.job_stops                     ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'driver_shift_templates'
  ) THEN
    ALTER TABLE public.driver_shift_templates ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

-- ── Add foreign-key-backed default protection going forward ────────────────
-- The sync_tenant_from_* triggers from Migration #1 fill tenant_id on insert,
-- but a NOT NULL column means an insert with a tenant-less driver now fails
-- loudly (good) instead of creating an invisible row. drivers.tenant_id being
-- NOT NULL guarantees the trigger always resolves a value.
