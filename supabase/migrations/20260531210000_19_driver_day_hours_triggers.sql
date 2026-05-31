-- Recompute driver_day_hours in real time whenever driving_legs or
-- stop_dwells changes.  Before this migration the day ledger was only
-- refreshed by the nightly shift-rollover cron, leaving the driver hours
-- dashboard stale throughout the day.
--
-- Strategy: a single recompute_driver_day_hours(uuid, date) helper is
-- called by AFTER triggers on both source tables.  Any INSERT / UPDATE /
-- DELETE to driving_legs or stop_dwells instantly recalculates that
-- driver's day, so the DriverHoursStatus component always reflects live
-- data.

-- ── 1. Recompute helper ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recompute_driver_day_hours(
  p_driver_id uuid,
  p_day date
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_drive   integer := 0;
  v_dead    integer := 0;
  v_other   integer := 0;
BEGIN
  -- Sum driving minutes from all legs for this driver on this day.
  -- Deadhead minutes = legs where from_warehouse_id IS NULL.
  SELECT
    COALESCE(SUM(COALESCE(dl.driving_minutes, 0)), 0),
    COALESCE(SUM(
      CASE WHEN dl.from_warehouse_id IS NULL
        THEN COALESCE(dl.driving_minutes, 0)
        ELSE 0
      END
    ), 0)
  INTO v_drive, v_dead
  FROM public.driving_legs dl
  WHERE dl.driver_id = p_driver_id
    AND dl.leg_date    = p_day;

  -- Sum dwell minutes.
  SELECT COALESCE(SUM(COALESCE(sd.dwell_minutes, 0)), 0)
  INTO v_other
  FROM public.stop_dwells sd
  WHERE sd.driver_id  = p_driver_id
    AND sd.dwell_date = p_day;

  -- Upsert into the ledger.
  -- shift_minutes, off_minutes, week_start, updated_at, and tenant_id are
  -- left to their existing values / defaults / triggers:
  --   - set_ddh_week_start  → populates week_start from day
  --   - touch_ddh_updated_at → stamps updated_at
  --   - trg_driver_day_hours_tenant → populates tenant_id on INSERT
  INSERT INTO public.driver_day_hours
    (driver_id, day, actual_driving_minutes, other_work_minutes,
     deadhead_minutes, drive_minutes)
  VALUES
    (p_driver_id, p_day, v_drive, v_other, v_dead, v_drive)
  ON CONFLICT (driver_id, day) DO UPDATE SET
    actual_driving_minutes = EXCLUDED.actual_driving_minutes,
    other_work_minutes     = EXCLUDED.other_work_minutes,
    deadhead_minutes       = EXCLUDED.deadhead_minutes,
    drive_minutes          = EXCLUDED.drive_minutes;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.recompute_driver_day_hours(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_driver_day_hours(uuid, date)
  TO service_role;

-- ── 2. Trigger on driving_legs ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_driving_legs_recompute_hours()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_driver_id uuid;
  v_date      date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_driver_id := OLD.driver_id;
    v_date      := OLD.leg_date;
  ELSE
    v_driver_id := NEW.driver_id;
    v_date      := NEW.leg_date;
  END IF;

  PERFORM public.recompute_driver_day_hours(v_driver_id, v_date);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_driving_legs_recompute_hours ON public.driving_legs;
CREATE TRIGGER trg_driving_legs_recompute_hours
  AFTER INSERT OR UPDATE OR DELETE
  ON public.driving_legs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_driving_legs_recompute_hours();

-- ── 3. Trigger on stop_dwells ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_stop_dwells_recompute_hours()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_driver_id uuid;
  v_date      date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_driver_id := OLD.driver_id;
    v_date      := OLD.dwell_date;
  ELSE
    v_driver_id := NEW.driver_id;
    v_date      := NEW.dwell_date;
  END IF;

  PERFORM public.recompute_driver_day_hours(v_driver_id, v_date);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_stop_dwells_recompute_hours ON public.stop_dwells;
CREATE TRIGGER trg_stop_dwells_recompute_hours
  AFTER INSERT OR UPDATE OR DELETE
  ON public.stop_dwells
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_stop_dwells_recompute_hours();
