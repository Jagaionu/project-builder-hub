ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS pairing_code TEXT,
  ADD COLUMN IF NOT EXISTS pairing_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS drivers_pairing_code_idx ON public.drivers (pairing_code) WHERE pairing_code IS NOT NULL;