ALTER TABLE public.jobs
  ADD COLUMN planned_driver_id uuid,
  ADD COLUMN planned_sequence integer,
  ADD COLUMN planned_start_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_planned_driver_idx ON public.jobs(planned_driver_id);