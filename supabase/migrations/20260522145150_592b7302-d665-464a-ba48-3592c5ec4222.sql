
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS login_code text UNIQUE;

CREATE OR REPLACE FUNCTION public.gen_driver_login_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  candidate text;
  exists_count int;
BEGIN
  LOOP
    candidate := lpad((floor(random() * 1000000))::int::text, 6, '0');
    SELECT count(*) INTO exists_count FROM public.drivers WHERE login_code = candidate;
    EXIT WHEN exists_count = 0;
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_driver_login_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.login_code IS NULL THEN
    NEW.login_code := public.gen_driver_login_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_driver_login_code ON public.drivers;
CREATE TRIGGER trg_set_driver_login_code
BEFORE INSERT ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.set_driver_login_code();

-- Backfill existing drivers
UPDATE public.drivers
SET login_code = public.gen_driver_login_code()
WHERE login_code IS NULL;
