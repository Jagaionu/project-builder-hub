-- ============================================================
-- MIGRATION #21: Optimizer prerequisites
--
-- 1. Make driver_shift_templates start/end times nullable so a
--    working day can have no fixed hours (available, compliance
--    limits only, no shift-end cap). The uq_driver_day unique
--    constraint already enforces one row per (driver_id, day_of_week).
--
-- 2. Add a unique index on lane_travel_times for the upsert key used
--    by the backfill / refresh (tenant_id, from_warehouse_id,
--    to_warehouse_id, day_of_week, hour_of_day). A unique constraint
--    already exists but uses NULLS NOT DISTINCT; this index provides
--    a named lookup path for query planning.
--
-- Safe to re-run: all DDL uses IF EXISTS / IF NOT EXISTS guards.
-- ============================================================

BEGIN;

-- 1. Make shift times optional

ALTER TABLE public.driver_shift_templates
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time   DROP NOT NULL,
  ALTER COLUMN start_time DROP DEFAULT,
  ALTER COLUMN end_time   DROP DEFAULT;

-- 2. Lane travel times lookup index

CREATE INDEX IF NOT EXISTS idx_lane_travel_times_upsert
  ON public.lane_travel_times (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day);

COMMIT;
