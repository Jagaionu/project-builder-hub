-- ─── driving_legs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.driving_legs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id          uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  job_id             uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  leg_date           date NOT NULL,
  from_warehouse_id  uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  from_label         text,
  from_lat           double precision,
  from_lon           double precision,
  to_warehouse_id    uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  to_label           text,
  to_lat             double precision,
  to_lon             double precision,
  departed_at        timestamptz,
  arrived_at         timestamptz,
  driving_minutes    integer,
  planned_minutes    integer,
  distance_km        double precision,
  source             text NOT NULL DEFAULT 'gps',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driving_legs_driver_date_idx ON public.driving_legs (driver_id, leg_date);
CREATE INDEX IF NOT EXISTS driving_legs_job_idx         ON public.driving_legs (job_id);

ALTER TABLE public.driving_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY driving_legs_tenant_select ON public.driving_legs
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driving_legs.driver_id
          AND (d.tenant_id = current_tenant_id() OR d.user_id = auth.uid()))
  OR is_super_admin()
);

CREATE POLICY driving_legs_tenant_insert ON public.driving_legs
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driving_legs.driver_id
          AND (d.tenant_id = current_tenant_id() OR d.user_id = auth.uid()))
  OR is_super_admin()
);

CREATE POLICY driving_legs_tenant_update ON public.driving_legs
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driving_legs.driver_id
          AND (d.tenant_id = current_tenant_id() OR d.user_id = auth.uid()))
  OR is_super_admin()
);

-- ─── stop_dwells ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stop_dwells (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  job_id          uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  job_stop_id     uuid REFERENCES public.job_stops(id) ON DELETE SET NULL,
  warehouse_id    uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  dwell_date      date NOT NULL,
  arrived_at      timestamptz,
  departed_at     timestamptz,
  dwell_minutes   integer,
  kind            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stop_dwells_driver_date_idx ON public.stop_dwells (driver_id, dwell_date);
CREATE INDEX IF NOT EXISTS stop_dwells_job_idx         ON public.stop_dwells (job_id);

ALTER TABLE public.stop_dwells ENABLE ROW LEVEL SECURITY;

CREATE POLICY stop_dwells_tenant_select ON public.stop_dwells
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = stop_dwells.driver_id
          AND (d.tenant_id = current_tenant_id() OR d.user_id = auth.uid()))
  OR is_super_admin()
);

CREATE POLICY stop_dwells_tenant_insert ON public.stop_dwells
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = stop_dwells.driver_id
          AND (d.tenant_id = current_tenant_id() OR d.user_id = auth.uid()))
  OR is_super_admin()
);

CREATE POLICY stop_dwells_tenant_update ON public.stop_dwells
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = stop_dwells.driver_id
          AND (d.tenant_id = current_tenant_id() OR d.user_id = auth.uid()))
  OR is_super_admin()
);

-- ─── driver_day_hours extension ──────────────────────────────────────────────
ALTER TABLE public.driver_day_hours
  ADD COLUMN IF NOT EXISTS actual_driving_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_work_minutes     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deadhead_minutes       integer NOT NULL DEFAULT 0;

-- ─── Realtime: legs + dwells stream live to the driver app ───────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.driving_legs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stop_dwells;