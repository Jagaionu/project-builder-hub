
CREATE TABLE public.driver_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE UNIQUE,
  days_of_week int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_shifts TO authenticated;
GRANT ALL ON public.driver_shifts TO service_role;

ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "driver views own shift" ON public.driver_shifts
  FOR SELECT TO authenticated
  USING (driver_id = public.current_driver_id()
    OR EXISTS (SELECT 1 FROM public.drivers d
               WHERE d.id = driver_id AND d.tenant_id = public.current_tenant_id()));

CREATE POLICY "driver manages own shift" ON public.driver_shifts
  FOR ALL TO authenticated
  USING (driver_id = public.current_driver_id()
    OR EXISTS (SELECT 1 FROM public.drivers d
               WHERE d.id = driver_id AND d.tenant_id = public.current_tenant_id()))
  WITH CHECK (driver_id = public.current_driver_id()
    OR EXISTS (SELECT 1 FROM public.drivers d
               WHERE d.id = driver_id AND d.tenant_id = public.current_tenant_id()));

CREATE TRIGGER driver_shifts_touch BEFORE UPDATE ON public.driver_shifts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.driver_availability_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  date date NOT NULL,
  available boolean NOT NULL,
  set_by text NOT NULL CHECK (set_by IN ('driver','planner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_availability_overrides TO authenticated;
GRANT ALL ON public.driver_availability_overrides TO service_role;

ALTER TABLE public.driver_availability_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view overrides" ON public.driver_availability_overrides
  FOR SELECT TO authenticated
  USING (driver_id = public.current_driver_id()
    OR EXISTS (SELECT 1 FROM public.drivers d
               WHERE d.id = driver_id AND d.tenant_id = public.current_tenant_id()));

CREATE POLICY "manage overrides" ON public.driver_availability_overrides
  FOR ALL TO authenticated
  USING (driver_id = public.current_driver_id()
    OR EXISTS (SELECT 1 FROM public.drivers d
               WHERE d.id = driver_id AND d.tenant_id = public.current_tenant_id()))
  WITH CHECK (driver_id = public.current_driver_id()
    OR EXISTS (SELECT 1 FROM public.drivers d
               WHERE d.id = driver_id AND d.tenant_id = public.current_tenant_id()));
