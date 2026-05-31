
-- ============================================================
-- MIGRATION: multi_tenant_auth
-- Adds companies, company_members, super_admins, tenant_id columns,
-- helper functions and tenant-isolated RLS. Includes driver-app
-- fallback so drivers (authenticated via drivers.user_id) keep
-- working under the new model.
-- ============================================================

-- ── 1. COMPANIES ─────────────────────────────────────────────
CREATE TABLE public.companies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  subscription_status   TEXT NOT NULL DEFAULT 'trial'
                          CHECK (subscription_status IN ('active','trial','suspended','cancelled')),
  subscription_ends_at  TIMESTAMPTZ,
  plan                  TEXT NOT NULL DEFAULT 'starter'
                          CHECK (plan IN ('starter','pro','enterprise')),
  config                JSONB NOT NULL DEFAULT '{
    "modules": ["dispatch","jobs","drivers","warehouses","alerts","events","maps","ai_agent"],
    "maxDrivers": 20,
    "maxWarehouses": 5,
    "showTelegramAlerts": true,
    "showComplianceModule": true,
    "customBranding": false,
    "brandName": null,
    "brandColor": null
  }'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── 2. COMPANY MEMBERS ───────────────────────────────────────
CREATE TABLE public.company_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('admin','member')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, user_id)
);

-- ── 3. SUPER ADMINS ──────────────────────────────────────────
CREATE TABLE public.super_admins (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. tenant_id COLUMNS (nullable for now — backfill later) ─
ALTER TABLE public.warehouses    ADD COLUMN tenant_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.drivers       ADD COLUMN tenant_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.jobs          ADD COLUMN tenant_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.driver_events ADD COLUMN tenant_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

CREATE INDEX idx_warehouses_tenant    ON public.warehouses(tenant_id);
CREATE INDEX idx_drivers_tenant       ON public.drivers(tenant_id);
CREATE INDEX idx_jobs_tenant          ON public.jobs(tenant_id);
CREATE INDEX idx_driver_events_tenant ON public.driver_events(tenant_id);

-- ── 5. HELPER FUNCTIONS (SECURITY DEFINER) ───────────────────

-- current_tenant_id: resolves from company_members OR drivers.user_id
-- so both dispatcher accounts and driver-app accounts work.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t FROM (
    SELECT company_id AS t FROM public.company_members WHERE user_id = auth.uid()
    UNION ALL
    SELECT tenant_id AS t FROM public.drivers WHERE user_id = auth.uid() AND tenant_id IS NOT NULL
  ) s
  WHERE t IS NOT NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.current_subscription_status()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.subscription_status
  FROM   public.companies c
  WHERE  c.id = public.current_tenant_id()
  LIMIT  1;
$$;

-- ── 6. DROP OLD OPEN POLICIES ────────────────────────────────
DROP POLICY IF EXISTS "public all" ON public.warehouses;
DROP POLICY IF EXISTS "public all" ON public.drivers;
DROP POLICY IF EXISTS "public all" ON public.jobs;
DROP POLICY IF EXISTS "public all" ON public.driver_events;

-- ── 7. TENANT-ISOLATED POLICIES ──────────────────────────────

-- WAREHOUSES
CREATE POLICY "tenant_select" ON public.warehouses FOR SELECT
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
CREATE POLICY "tenant_insert" ON public.warehouses FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_subscription_status() IN ('active','trial')
  );
CREATE POLICY "tenant_update" ON public.warehouses FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (public.current_subscription_status() IN ('active','trial'));
CREATE POLICY "tenant_delete" ON public.warehouses FOR DELETE
  USING (tenant_id = public.current_tenant_id());

-- DRIVERS — plus self-access for the driver app
CREATE POLICY "tenant_select" ON public.drivers FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR user_id = auth.uid()
    OR public.is_super_admin()
  );
CREATE POLICY "tenant_insert" ON public.drivers FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_subscription_status() IN ('active','trial')
  );
CREATE POLICY "tenant_update" ON public.drivers FOR UPDATE
  USING (tenant_id = public.current_tenant_id() OR user_id = auth.uid())
  WITH CHECK (public.current_subscription_status() IN ('active','trial') OR user_id = auth.uid());
CREATE POLICY "tenant_delete" ON public.drivers FOR DELETE
  USING (tenant_id = public.current_tenant_id());

-- JOBS
CREATE POLICY "tenant_select" ON public.jobs FOR SELECT
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
CREATE POLICY "tenant_insert" ON public.jobs FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_subscription_status() IN ('active','trial')
  );
CREATE POLICY "tenant_update" ON public.jobs FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (public.current_subscription_status() IN ('active','trial'));
CREATE POLICY "tenant_delete" ON public.jobs FOR DELETE
  USING (tenant_id = public.current_tenant_id());

-- DRIVER EVENTS (immutable log — no update/delete)
CREATE POLICY "tenant_select" ON public.driver_events FOR SELECT
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
CREATE POLICY "tenant_insert" ON public.driver_events FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_subscription_status() IN ('active','trial')
  );

-- COMPANIES
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_company_select" ON public.companies FOR SELECT
  USING (id = public.current_tenant_id() OR public.is_super_admin());
CREATE POLICY "super_admin_all" ON public.companies FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- COMPANY MEMBERS
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_membership_select" ON public.company_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_super_admin());
CREATE POLICY "super_admin_all" ON public.company_members FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- SUPER ADMINS — only super_admins can read
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_only" ON public.super_admins FOR ALL
  USING (public.is_super_admin());
