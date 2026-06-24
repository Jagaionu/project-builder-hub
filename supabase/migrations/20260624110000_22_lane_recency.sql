-- ============================================================
-- 22: lane_travel_times recency window + trend
--
-- Additive and idempotent. Adds a rolling 21-day recent estimate and a
-- trend flag alongside the existing 90-day stats so planning can react
-- faster to real shifts (road works / a newly busier lane) without losing
-- the stable 90-day baseline. No existing column, value, or behaviour
-- changes; the planner only starts using these once its SELECT is widened.
-- The existing hourly cron ('hourly-lane-travel-times') automatically runs
-- this replaced function — no reschedule needed.
-- ============================================================

BEGIN;

-- 1) Additive columns (nullable)
ALTER TABLE public.lane_travel_times
  ADD COLUMN IF NOT EXISTS recent_avg_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS recent_p50_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS recent_sample_count        integer,
  ADD COLUMN IF NOT EXISTS trend_pct                  numeric,
  ADD COLUMN IF NOT EXISTS trend_state                text;

-- 2) Upgraded aggregation: 90-day baseline (unchanged) + 21-day recent + trend
CREATE OR REPLACE FUNCTION public.refresh_lane_travel_times()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_cutoff timestamptz := now() - interval '90 days';
  v_recent timestamptz := now() - interval '21 days';
BEGIN
  -- a) Global cross-tenant aggregates (tenant_id = NULL)
  INSERT INTO public.lane_travel_times
    (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day,
     avg_duration_minutes, p50_duration_minutes, p90_duration_minutes, sample_count,
     recent_avg_duration_minutes, recent_p50_duration_minutes, recent_sample_count,
     trend_pct, trend_state, last_updated)
  SELECT
    g.tenant_id, g.from_warehouse_id, g.to_warehouse_id, g.dow, g.hod,
    g.avg_d, g.p50_d, g.p90_d, g.n_d,
    g.r_avg, g.r_p50, g.r_n,
    tr.t_pct, tr.t_state, now()
  FROM (
    SELECT
      NULL::uuid AS tenant_id,
      dl.from_warehouse_id, dl.to_warehouse_id,
      EXTRACT(DOW  FROM dl.departed_at)::smallint AS dow,
      EXTRACT(HOUR FROM dl.departed_at)::smallint AS hod,
      ROUND(AVG(dl.driving_minutes))::int AS avg_d,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY dl.driving_minutes)::int AS p50_d,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY dl.driving_minutes)::int AS p90_d,
      COUNT(*)::int AS n_d,
      ROUND(AVG(dl.driving_minutes) FILTER (WHERE dl.departed_at >= v_recent))::int AS r_avg,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY dl.driving_minutes)
         FILTER (WHERE dl.departed_at >= v_recent))::int AS r_p50,
      COUNT(*) FILTER (WHERE dl.departed_at >= v_recent)::int AS r_n
    FROM public.driving_legs dl
    WHERE dl.departed_at >= v_cutoff
      AND dl.from_warehouse_id IS NOT NULL
      AND dl.to_warehouse_id   IS NOT NULL
      AND dl.driving_minutes   IS NOT NULL
      AND dl.driving_minutes   > 0
    GROUP BY dl.from_warehouse_id, dl.to_warehouse_id,
             EXTRACT(DOW FROM dl.departed_at), EXTRACT(HOUR FROM dl.departed_at)
  ) g
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN g.p50_d IS NOT NULL AND g.p50_d > 0 AND g.r_p50 IS NOT NULL
           THEN ROUND(((g.r_p50 - g.p50_d)::numeric / g.p50_d) * 100, 1) END AS t_pct,
      CASE WHEN g.r_p50 IS NULL OR g.p50_d IS NULL OR COALESCE(g.r_n, 0) < 5 THEN 'stable'
           WHEN g.r_p50 >= g.p50_d * 1.25 AND (g.r_p50 - g.p50_d) >= 15 THEN 'rising'
           WHEN g.r_p50 <= g.p50_d * 0.80 AND (g.p50_d - g.r_p50) >= 15 THEN 'falling'
           ELSE 'stable' END AS t_state
  ) tr
  ON CONFLICT (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day)
  DO UPDATE SET
    avg_duration_minutes        = EXCLUDED.avg_duration_minutes,
    p50_duration_minutes        = EXCLUDED.p50_duration_minutes,
    p90_duration_minutes        = EXCLUDED.p90_duration_minutes,
    sample_count                = EXCLUDED.sample_count,
    recent_avg_duration_minutes = EXCLUDED.recent_avg_duration_minutes,
    recent_p50_duration_minutes = EXCLUDED.recent_p50_duration_minutes,
    recent_sample_count         = EXCLUDED.recent_sample_count,
    trend_pct                   = EXCLUDED.trend_pct,
    trend_state                 = EXCLUDED.trend_state,
    last_updated                = EXCLUDED.last_updated;

  -- b) Per-tenant aggregates
  INSERT INTO public.lane_travel_times
    (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day,
     avg_duration_minutes, p50_duration_minutes, p90_duration_minutes, sample_count,
     recent_avg_duration_minutes, recent_p50_duration_minutes, recent_sample_count,
     trend_pct, trend_state, last_updated)
  SELECT
    g.tenant_id, g.from_warehouse_id, g.to_warehouse_id, g.dow, g.hod,
    g.avg_d, g.p50_d, g.p90_d, g.n_d,
    g.r_avg, g.r_p50, g.r_n,
    tr.t_pct, tr.t_state, now()
  FROM (
    SELECT
      dl.tenant_id,
      dl.from_warehouse_id, dl.to_warehouse_id,
      EXTRACT(DOW  FROM dl.departed_at)::smallint AS dow,
      EXTRACT(HOUR FROM dl.departed_at)::smallint AS hod,
      ROUND(AVG(dl.driving_minutes))::int AS avg_d,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY dl.driving_minutes)::int AS p50_d,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY dl.driving_minutes)::int AS p90_d,
      COUNT(*)::int AS n_d,
      ROUND(AVG(dl.driving_minutes) FILTER (WHERE dl.departed_at >= v_recent))::int AS r_avg,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY dl.driving_minutes)
         FILTER (WHERE dl.departed_at >= v_recent))::int AS r_p50,
      COUNT(*) FILTER (WHERE dl.departed_at >= v_recent)::int AS r_n
    FROM public.driving_legs dl
    WHERE dl.departed_at >= v_cutoff
      AND dl.tenant_id         IS NOT NULL
      AND dl.from_warehouse_id IS NOT NULL
      AND dl.to_warehouse_id   IS NOT NULL
      AND dl.driving_minutes   IS NOT NULL
      AND dl.driving_minutes   > 0
    GROUP BY dl.tenant_id, dl.from_warehouse_id, dl.to_warehouse_id,
             EXTRACT(DOW FROM dl.departed_at), EXTRACT(HOUR FROM dl.departed_at)
  ) g
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN g.p50_d IS NOT NULL AND g.p50_d > 0 AND g.r_p50 IS NOT NULL
           THEN ROUND(((g.r_p50 - g.p50_d)::numeric / g.p50_d) * 100, 1) END AS t_pct,
      CASE WHEN g.r_p50 IS NULL OR g.p50_d IS NULL OR COALESCE(g.r_n, 0) < 5 THEN 'stable'
           WHEN g.r_p50 >= g.p50_d * 1.25 AND (g.r_p50 - g.p50_d) >= 15 THEN 'rising'
           WHEN g.r_p50 <= g.p50_d * 0.80 AND (g.p50_d - g.r_p50) >= 15 THEN 'falling'
           ELSE 'stable' END AS t_state
  ) tr
  ON CONFLICT (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day)
  DO UPDATE SET
    avg_duration_minutes        = EXCLUDED.avg_duration_minutes,
    p50_duration_minutes        = EXCLUDED.p50_duration_minutes,
    p90_duration_minutes        = EXCLUDED.p90_duration_minutes,
    sample_count                = EXCLUDED.sample_count,
    recent_avg_duration_minutes = EXCLUDED.recent_avg_duration_minutes,
    recent_p50_duration_minutes = EXCLUDED.recent_p50_duration_minutes,
    recent_sample_count         = EXCLUDED.recent_sample_count,
    trend_pct                   = EXCLUDED.trend_pct,
    trend_state                 = EXCLUDED.trend_state,
    last_updated                = EXCLUDED.last_updated;
END;
$fn$;

COMMIT;
