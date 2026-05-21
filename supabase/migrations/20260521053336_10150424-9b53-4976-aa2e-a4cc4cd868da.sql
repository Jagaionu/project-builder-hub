
CREATE OR REPLACE FUNCTION public.set_week_start()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.week_start := (NEW.day - ((EXTRACT(ISODOW FROM NEW.day)::int - 1)))::date;
  RETURN NEW;
END;
$$;
