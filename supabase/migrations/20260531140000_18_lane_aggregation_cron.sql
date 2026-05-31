-- ============================================================
-- 18: lane_travel_times async aggregation via pg_cron
--
-- Populates the empty lane_travel_times table from driving_legs
-- telemetry every hour.  Uses INSERT … ON CONFLICT DO UPDATE
-- so no row-level read-modify-write locks — zero scheduler impact.
--
-- The retention policy (migration 16) already gates driving_legs
-- deletion on whether lane_travel_times.last_updated is within
-- 7 days.  This is the missing piece that unblocks that policy.
-- ============================================================

BEGIN;

-- ── 1. Drop-and-recreate guard (idempotent) ────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('hourly-lane-travel-times');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 2. Core aggregation function ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_lane_travel_times()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_cutoff timestamptz := now() - interval '90 days';
BEGIN
  -- ── a) Global cross-tenant aggregates (tenant_id = NULL) ────────────
  INSERT INTO public.lane_travel_times
    (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day,
     avg_duration_minutes, p50_duration_minutes, p90_duration_minutes,
     sample_count, last_updated)
  SELECT
    NULL,
    dl.from_warehouse_id,
    dl.to_warehouse_id,
    EXTRACT(DOW FROM dl.departed_at)::smallint,
    EXTRACT(HOUR FROM dl.departed_at)::smallint,
    ROUND(AVG(dl.driving_minutes))::int,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY dl.driving_minutes)::int,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY dl.driving_minutes)::int,
    COUNT(*)::int,
    now()
  FROM public.driving_legs dl
  WHERE dl.departed_at >= v_cutoff
    AND dl.from_warehouse_id IS NOT NULL
    AND dl.to_warehouse_id IS NOT NULL
    AND dl.driving_minutes IS NOT NULL
    AND dl.driving_minutes > 0
  GROUP BY dl.from_warehouse_id, dl.to_warehouse_id,
           EXTRACT(DOW FROM dl.departed_at), EXTRACT(HOUR FROM dl.departed_at)
  ON CONFLICT (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day)
  DO UPDATE SET
    avg_duration_minutes = EXCLUDED.avg_duration_minutes,
    p50_duration_minutes = EXCLUDED.p50_duration_minutes,
    p90_duration_minutes = EXCLUDED.p90_duration_minutes,
    sample_count       = EXCLUDED.sample_count,
    last_updated       = EXCLUDED.last_updated;

  -- ── b) Per-tenant aggregates ────────────────────────────────────────
  INSERT INTO public.lane_travel_times
    (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day,
     avg_duration_minutes, p50_duration_minutes, p90_duration_minutes,
     sample_count, last_updated)
  SELECT
    dl.tenant_id,
    dl.from_warehouse_id,
    dl.to_warehouse_id,
    EXTRACT(DOW FROM dl.departed_at)::smallint,
    EXTRACT(HOUR FROM dl.departed_at)::smallint,
    ROUND(AVG(dl.driving_minutes))::int,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY dl.driving_minutes)::int,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY dl.driving_minutes)::int,
    COUNT(*)::int,
    now()
  FROM public.driving_legs dl
  WHERE dl.departed_at >= v_cutoff
    AND dl.tenant_id IS NOT NULL
    AND dl.from_warehouse_id IS NOT NULL
    AND dl.to_warehouse_id IS NOT NULL
    AND dl.driving_minutes IS NOT NULL
    AND dl.driving_minutes > 0
  GROUP BY dl.tenant_id, dl.from_warehouse_id, dl.to_warehouse_id,
           EXTRACT(DOW FROM dl.departed_at), EXTRACT(HOUR FROM dl.departed_at)
  ON CONFLICT (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day)
  DO UPDATE SET
    avg_duration_minutes = EXCLUDED.avg_duration_minutes,
    p50_duration_minutes = EXCLUDED.p50_duration_minutes,
    p90_duration_minutes = EXCLUDED.p90_duration_minutes,
    sample_count       = EXCLUDED.sample_count,
    last_updated       = EXCLUDED.last_updated;
END;
$fn$;

-- ── 3. Secure the function (service_role only) ───────────────────────────
REVOKE EXECUTE ON FUNCTION public.refresh_lane_travel_times()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_lane_travel_times()
  TO service_role;

-- ── 4. Schedule every hour at 15 minutes past ─────────────────────────────
SELECT cron.schedule(
  'hourly-lane-travel-times',
  '15 * * * *',
  'SELECT public.refresh_lane_travel_times();'
);

COMMIT;
