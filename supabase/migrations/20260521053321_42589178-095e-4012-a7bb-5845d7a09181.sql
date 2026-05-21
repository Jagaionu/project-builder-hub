
CREATE OR REPLACE FUNCTION public.set_week_start()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.week_start := (NEW.day - ((EXTRACT(ISODOW FROM NEW.day)::int - 1)))::date;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.driver_day_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  day date NOT NULL,
  shift_minutes integer NOT NULL DEFAULT 0,
  drive_minutes integer NOT NULL DEFAULT 0,
  off_minutes integer NOT NULL DEFAULT 1440,
  week_start date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, day)
);

CREATE INDEX IF NOT EXISTS idx_ddh_driver_day ON public.driver_day_hours (driver_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_ddh_driver_week ON public.driver_day_hours (driver_id, week_start);

ALTER TABLE public.driver_day_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public all" ON public.driver_day_hours FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER touch_ddh_updated_at
BEFORE UPDATE ON public.driver_day_hours
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER set_ddh_week_start
BEFORE INSERT OR UPDATE OF day ON public.driver_day_hours
FOR EACH ROW EXECUTE FUNCTION public.set_week_start();
