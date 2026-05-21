ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS available_tomorrow boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tomorrow_start_lat double precision,
  ADD COLUMN IF NOT EXISTS tomorrow_start_lon double precision,
  ADD COLUMN IF NOT EXISTS tomorrow_start_updated_at timestamptz;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS for_date date;

UPDATE jobs SET for_date = (scheduled_at::date) WHERE scheduled_at IS NOT NULL AND for_date IS NULL;