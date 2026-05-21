CREATE OR REPLACE FUNCTION public.sync_job_for_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_job uuid;
  first_arrival timestamptz;
BEGIN
  target_job := COALESCE(NEW.job_id, OLD.job_id);
  SELECT MIN(scheduled_at) INTO first_arrival
  FROM public.job_stops
  WHERE job_id = target_job AND scheduled_at IS NOT NULL;

  UPDATE public.jobs
  SET for_date = CASE
    WHEN first_arrival IS NOT NULL THEN (first_arrival AT TIME ZONE 'UTC')::date
    ELSE NULL
  END
  WHERE id = target_job;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_job_for_date ON public.job_stops;
CREATE TRIGGER trg_sync_job_for_date
AFTER INSERT OR UPDATE OR DELETE ON public.job_stops
FOR EACH ROW
EXECUTE FUNCTION public.sync_job_for_date();

-- Backfill existing jobs from their first stop's scheduled_at
UPDATE public.jobs j
SET for_date = sub.d
FROM (
  SELECT job_id, (MIN(scheduled_at) AT TIME ZONE 'UTC')::date AS d
  FROM public.job_stops
  WHERE scheduled_at IS NOT NULL
  GROUP BY job_id
) sub
WHERE j.id = sub.job_id
  AND (j.for_date IS DISTINCT FROM sub.d);