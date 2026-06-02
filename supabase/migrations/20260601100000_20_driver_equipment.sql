-- ============================================================
-- MIGRATION #20: Driver equipment capabilities
--
-- Every driver can be tagged with one or more equipment types
-- (e.g. 'curtain-sider', 'refrigerated', 'flatbed', 'tanker').
-- The planner MUST match job.equipment_type to a driver's
-- capabilities — a no-cap driver or mismatched equipment means
-- the job is unassignable to that driver.
--
-- This migration is additive and idempotent (IF NOT EXISTS).
-- No existing data is modified.
-- ============================================================

-- 1. driver_equipment table

CREATE TABLE IF NOT EXISTS public.driver_equipment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id       uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  equipment_type  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, equipment_type)
);

CREATE INDEX IF NOT EXISTS idx_driver_equipment_lookup
  ON public.driver_equipment (driver_id, equipment_type);

COMMENT ON TABLE public.driver_equipment IS
  'Per-driver equipment type capabilities. Each row means "this driver can '
  'operate this equipment type". A driver with no rows has no equipment '
  'restrictions (backward-compatible: matches any job).';

COMMENT ON COLUMN public.driver_equipment.equipment_type IS
  'Equipment type the driver is qualified to operate. Matches jobs.equipment_type. '
  'Standard types: curtain-sider, refrigerated, flatbed, tanker, tipper, box.';

-- 2. RLS

ALTER TABLE public.driver_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_equipment_select ON public.driver_equipment;
DROP POLICY IF EXISTS driver_equipment_mutate ON public.driver_equipment;

CREATE POLICY driver_equipment_select ON public.driver_equipment
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY driver_equipment_mutate ON public.driver_equipment
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_equipment TO authenticated;
GRANT ALL                            ON public.driver_equipment TO service_role;

-- 3. Tenant sync trigger

CREATE OR REPLACE FUNCTION public.sync_equipment_tenant_from_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.drivers
    WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_equipment_tenant ON public.driver_equipment;
CREATE TRIGGER trg_driver_equipment_tenant
  BEFORE INSERT ON public.driver_equipment
  FOR EACH ROW EXECUTE FUNCTION public.sync_equipment_tenant_from_driver();
