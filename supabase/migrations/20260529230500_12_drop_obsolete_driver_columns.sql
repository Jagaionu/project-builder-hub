-- ============================================================
-- MIGRATION #12: Drop obsolete driver columns
--
-- The legacy "available tomorrow / start shift" workaround is fully replaced
-- by calendar-based availability (driver_shift_templates +
-- driver_availability_overrides) and drivers.home_warehouse_id.
--
-- App code no longer reads or writes these columns (planner.ts cleaned up in
-- the same commit; src/lib/types.ts and the generated Supabase types updated).
--
-- Idempotent (IF EXISTS). Safe to run even if you already dropped them by hand.
-- ============================================================

ALTER TABLE public.drivers
  DROP COLUMN IF EXISTS available_tomorrow,
  DROP COLUMN IF EXISTS tomorrow_start_lat,
  DROP COLUMN IF EXISTS tomorrow_start_lon,
  DROP COLUMN IF EXISTS tomorrow_start_updated_at;
