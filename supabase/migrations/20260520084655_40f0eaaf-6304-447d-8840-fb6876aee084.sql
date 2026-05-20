
-- Enums
CREATE TYPE driver_status AS ENUM ('AVAILABLE','ON_SHIFT','ON_ROUTE','DELAYED','OFF_SHIFT');
CREATE TYPE job_status AS ENUM ('PENDING','ASSIGNED','IN_PROGRESS','ARRIVED_PICKUP','EN_ROUTE_DELIVERY','COMPLETED','CANCELLED');
CREATE TYPE driver_event_type AS ENUM ('START_SHIFT','LOCATION_UPDATE','ACCEPT_JOB','REJECT_JOB','ARRIVED','DEPARTED','DELAY_REPORT','END_SHIFT');

CREATE TABLE public.warehouses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.drivers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  telegram_id TEXT UNIQUE,
  current_lat DOUBLE PRECISION,
  current_lon DOUBLE PRECISION,
  status driver_status NOT NULL DEFAULT 'OFF_SHIFT',
  last_update_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE DEFAULT ('JOB-' || upper(substring(gen_random_uuid()::text,1,6))),
  origin_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  destination_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  assigned_driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  status job_status NOT NULL DEFAULT 'PENDING',
  eta_minutes INTEGER,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.driver_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  type driver_event_type NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_driver_events_driver ON public.driver_events(driver_id, timestamp DESC);
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_jobs_driver ON public.jobs(assigned_driver_id);

-- Updated_at trigger for jobs
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: planner tool (no auth yet) - allow all for anon. Tighten when auth added.
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public all" ON public.warehouses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all" ON public.drivers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all" ON public.jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all" ON public.driver_events FOR ALL USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_events;
