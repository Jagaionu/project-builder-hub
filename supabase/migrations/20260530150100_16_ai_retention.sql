-- ============================================================
-- Extend run_data_retention with AI agent table cleanup
-- Prerequisites: migration 20260530150000_15_ai_agent_additive.sql
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
  DELETE FROM public.planning_queue
  WHERE processed_at IS NOT NULL
    AND processed_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: planning_queue purged % rows', v_n;

  DELETE FROM public.pending_job_imports
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: pending_job_imports purged % rows', v_n;

  DELETE FROM public.driver_availability_overrides
  WHERE date < (now() - interval '90 days')::date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: driver_availability_overrides purged % past rows', v_n;

  UPDATE public.routes
  SET deleted_at = now()
  WHERE route_date < (now() - interval '1 year')::date
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: routes soft-deleted % old rows', v_n;

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
    RAISE NOTICE 'retention: driving_legs purge SKIPPED — lane_travel_times not yet being populated';
  END IF;

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
    RAISE NOTICE 'retention: stop_dwells purge SKIPPED — warehouse_dwell_profiles not yet being populated';
  END IF;

  DELETE FROM public.driver_day_hours
  WHERE day < (now() - interval '2 years')::date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: driver_day_hours purged % rows (>2y)', v_n;

  -- AI agent ephemeral data
  DELETE FROM public.ai_pending_actions
  WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: ai_pending_actions purged % expired rows', v_n;

  DELETE FROM public.ai_conversations
  WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: ai_conversations purged % rows (>90d)', v_n;

  DELETE FROM public.ai_query_logs
  WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'retention: ai_query_logs purged % rows (>90d)', v_n;
END;
$$;
