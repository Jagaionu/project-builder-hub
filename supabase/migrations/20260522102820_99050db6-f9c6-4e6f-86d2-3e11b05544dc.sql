
-- 1. Add user_id to drivers (nullable; backfilled on first pairing-code login)
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Pairing codes table (server-only)
CREATE TABLE IF NOT EXISTS public.pairing_codes (
  code text PRIMARY KEY,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_driver ON public.pairing_codes(driver_id);

ALTER TABLE public.pairing_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pairing_codes deny all" ON public.pairing_codes;
CREATE POLICY "pairing_codes deny all" ON public.pairing_codes
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

-- 3. Driver positions (GPS breadcrumbs)
CREATE TABLE IF NOT EXISTS public.driver_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_positions_driver_time
  ON public.driver_positions(driver_id, created_at DESC);

ALTER TABLE public.driver_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public all" ON public.driver_positions;
CREATE POLICY "public all" ON public.driver_positions
  FOR ALL USING (true) WITH CHECK (true);

-- 4. Helper: current user's driver id
CREATE OR REPLACE FUNCTION public.current_driver_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.drivers WHERE user_id = auth.uid() LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.current_driver_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_driver_id() TO authenticated;

-- 5. Realtime publication (idempotent: ignore if already added)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.job_stops;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
