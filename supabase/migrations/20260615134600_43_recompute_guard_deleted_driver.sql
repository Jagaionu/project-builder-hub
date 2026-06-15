-- MIGRATION #43: stop company deletion from failing via the hours-recompute path.
--
-- trg_driving_legs_recompute_hours / trg_stop_dwells_recompute_hours fire on
-- DELETE and call recompute_driver_day_hours(), which INSERTs a driver_day_hours
-- row WITHOUT tenant_id (filled by the BEFORE-INSERT sync trigger). During a
-- company delete the cascade removes driving_legs/stop_dwells AND the driver, so
-- the re-insert resolves tenant_id from a now-deleted driver -> NULL -> NOT NULL
-- violation. Guard: if the driver no longer exists, skip the recompute entirely.
CREATE OR REPLACE FUNCTION public.recompute_driver_day_hours(p_driver_id uuid, p_day date)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_drive integer := 0; v_dead integer := 0; v_other integer := 0;
BEGIN
  -- Skip recompute for a driver that no longer exists (e.g. mid delete-cascade).
  IF p_driver_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(COALESCE(dl.driving_minutes,0)),0),
         COALESCE(SUM(CASE WHEN dl.from_warehouse_id IS NULL THEN COALESCE(dl.driving_minutes,0) ELSE 0 END),0)
    INTO v_drive, v_dead
  FROM public.driving_legs dl WHERE dl.driver_id = p_driver_id AND dl.leg_date = p_day;
  SELECT COALESCE(SUM(COALESCE(sd.dwell_minutes,0)),0) INTO v_other
  FROM public.stop_dwells sd WHERE sd.driver_id = p_driver_id AND sd.dwell_date = p_day;
  INSERT INTO public.driver_day_hours (driver_id, day, actual_driving_minutes, other_work_minutes, deadhead_minutes)
  VALUES (p_driver_id, p_day, v_drive, v_other, v_dead)
  ON CONFLICT (driver_id, day) DO UPDATE SET
    actual_driving_minutes = EXCLUDED.actual_driving_minutes,
    other_work_minutes     = EXCLUDED.other_work_minutes,
    deadhead_minutes       = EXCLUDED.deadhead_minutes;
END; $function$;
