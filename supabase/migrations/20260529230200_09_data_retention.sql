-- ============================================================
-- MIGRATION #9: Automated data retention (pg_cron)
--
-- DO NOT RUN UNTIL REVIEWED.
-- Prerequisites: Migrations #1-#8 applied. Requires pg_cron (already in use
--   on this project — see cleanup-expired-import-batches).
--
-- Implements the retention policy: ephemeral operational data is purged on a
-- schedule; compliance/audit/historical data is retained.
--
-- ALREADY HANDLED ELSEWHERE (not repeated here):
--   • import_batches (14d) — cron 'cleanup-expired-import-batches' (cascades
--     to its jobs + parked imports via ON DELETE CASCADE).
--   • driver_positions partitions — cron in migration #8
--     ('driver-positions-partitions': create next month, drop old months).
--
-- RETAINED FOREVER (never deleted by this job — only soft-delete/aggregate):
--   • driver_events      — compliance (driver hours / breaks). 7+ years.
--   • audit_planning_log  — legal record of dispatch decisions. 7+ years.
--   • routes / route_jobs — permanent planned-vs-actual record (soft-delete only).
--
-- This job (run_data_retention) handles:
--   1. planning_queue          — delete processed rows > 30 days old
--   2. pending_job_imports     — delete parked rows > 30 days old (cascades stops)
--   3. driver_availability_overrides — delete PAST overrides > 90 days old
--                                 (NEVER future-dated holidays / days off)
--   4. routes                  — soft-delete (deleted_at) rows > 1 year old
--   5. driving_legs            — delete raw legs > 90 days, ONLY once their
--                                 data has been aggregated into lane_travel_times
--   6. stop_dwells             — delete raw dwells > 90 days, ONLY once
--                                 aggregated into warehouse_dwell_profiles
--   7. driver_day_hours        — delete rows > 2 years old (payroll audit window)
--
-- SAFETY: legs/dwells (5,6) are the only source of ETA-learning data and the
-- aggregation pipeline is not built yet. Their purge is GATED on the aggregate
-- tables being actively populated (a recent last_updated). Until aggregation
-- runs, raw rows are KEPT (the job logs a NOTICE and skips), so we never lose
-- un-aggregated data. Once aggregation starts writing, purge auto-enables.
-- ============================================================

CREATE OR REPLACE FUNCTION public.run_data_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_n           bigint;
  v_legs_ready  boolean;
  v_dwell_ready boolean;
BEGIN
  -- 1. planning_queue: drop processed events older than 30 days.
  DELETE FROM public.planning_queue
  WHERE processed_at IS NOT NULL
    AND processed_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: planning_queue purged % rows', v_n;

  -- 2. pending_job_imports: drop parked rows older than 30 days
  --    (pending_import_stops cascades via ON DELETE CASCADE).
  DELETE FROM public.pending_job_imports
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: pending_job_imports purged % rows', v_n;

  -- 3. driver_availability_overrides: drop ONLY past overrides older than
  --    90 days. Future-dated overrides (holidays, planned days off) are the
  --    planner's source of truth and must never be removed.
  DELETE FROM public.driver_availability_overrides
  WHERE date < (now() - interval '90 days')::date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: driver_availability_overrides purged % past rows', v_n;

  -- 4. routes: soft-delete (hide) plans older than 1 year. Never hard-deleted
  --    here — they are the permanent historical record.
  UPDATE public.routes
  SET deleted_at = now()
  WHERE route_date < (now() - interval '1 year')::date
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: routes soft-deleted % old rows', v_n;

  -- 5. driving_legs: purge raw legs > 90 days, but ONLY if lane aggregation
  --    is live (lane_travel_times updated in the last 7 days). Otherwise keep
  --    them so the future ETA-learning job can still consume them.
  SELECT EXISTS (
    SELECT 1 FROM public.lane_travel_times
    WHERE last_updated > now() - interval '7 days'
  ) INTO v_legs_ready;

  IF v_legs_ready THEN
    DELETE FROM public.driving_legs
    WHERE leg_date < (now() - interval '90 days')::date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'retention: driving_legs purged % rows (aggregation live)', v_n;
  ELSE
    RAISE NOTICE 'retention: driving_legs purge SKIPPED — lane_travel_times not '
                 'yet being populated; keeping raw legs to avoid losing ETA data.';
  END IF;

  -- 6. stop_dwells: same gating against warehouse_dwell_profiles.
  SELECT EXISTS (
    SELECT 1 FROM public.warehouse_dwell_profiles
    WHERE last_updated > now() - interval '7 days'
  ) INTO v_dwell_ready;

  IF v_dwell_ready THEN
    DELETE FROM public.stop_dwells
    WHERE dwell_date < (now() - interval '90 days')::date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'retention: stop_dwells purged % rows (aggregation live)', v_n;
  ELSE
    RAISE NOTICE 'retention: stop_dwells purge SKIPPED — warehouse_dwell_profiles '
                 'not yet being populated; keeping raw dwells.';
  END IF;

  -- 7. driver_day_hours: payroll/compliance audit window. Keep 2 years.
  DELETE FROM public.driver_day_hours
  WHERE day < (now() - interval '2 years')::date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: driver_day_hours purged % rows (>2y)', v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_data_retention() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.run_data_retention() TO service_role;

-- ── Schedule: daily at 02:00 UTC ──────────────────────────────────────────
-- Idempotent: unschedule any prior version first (ignore if absent).
DO $$
BEGIN
  PERFORM cron.unschedule('daily-data-retention');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'daily-data-retention',
  '0 2 * * *',
  $$ SELECT public.run_data_retention(); $$
);

-- ════════════════════════════════════════════════════════════════════
-- FOLLOW-UP WORK (not in this migration — needs design):
--   • Build the aggregation jobs that populate lane_travel_times and
--     warehouse_dwell_profiles from driving_legs / stop_dwells. Until then,
--     steps 5 & 6 above intentionally skip (raw data is preserved).
--   • driver_events: keep raw 90 days, then roll up into daily summaries
--     (driver_day_hours already captures shift/drive minutes via the
--     shift-ledger). A dedicated 90-day rollup + archival can come later.
--   • audit_planning_log: consider monthly partitioning + cold-storage
--     archival once volume grows. Never hard-deleted from the live DB.
-- ════════════════════════════════════════════════════════════════════
