-- ============================================================
-- MIGRATION #26: job_stops.yard_departure — planned yard departure time
-- Additive + idempotent. Populated from the FMC bulk upload (Stop N Yard
-- Departure). scheduled_at already holds the planned yard ARRIVAL.
-- ============================================================
ALTER TABLE public.job_stops
  ADD COLUMN IF NOT EXISTS yard_departure timestamptz;
