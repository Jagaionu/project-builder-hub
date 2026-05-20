
CREATE TYPE public.registration_status AS ENUM ('AWAITING_NAME','AWAITING_PHONE','PENDING','APPROVED','REJECTED');

CREATE TABLE public.driver_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id text NOT NULL UNIQUE,
  name text,
  phone text,
  status public.registration_status NOT NULL DEFAULT 'AWAITING_NAME',
  driver_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public all" ON public.driver_registrations FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER driver_registrations_touch_updated_at
  BEFORE UPDATE ON public.driver_registrations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_registrations;
