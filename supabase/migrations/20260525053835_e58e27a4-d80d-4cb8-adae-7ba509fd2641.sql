
-- 1) Replace open "public all" policies with tenant-scoped policies.

-- driver_day_hours: scope via drivers.tenant_id (matches stop_dwells/driving_legs pattern)
DROP POLICY IF EXISTS "public all" ON public.driver_day_hours;

CREATE POLICY "driver_day_hours_tenant_select" ON public.driver_day_hours
FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = driver_day_hours.driver_id
      AND (d.tenant_id = public.current_tenant_id() OR d.user_id = auth.uid())
  ) OR public.is_super_admin()
);

CREATE POLICY "driver_day_hours_tenant_insert" ON public.driver_day_hours
FOR INSERT TO public
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = driver_day_hours.driver_id
      AND (d.tenant_id = public.current_tenant_id() OR d.user_id = auth.uid())
  ) OR public.is_super_admin()
);

CREATE POLICY "driver_day_hours_tenant_update" ON public.driver_day_hours
FOR UPDATE TO public
USING (
  EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = driver_day_hours.driver_id
      AND (d.tenant_id = public.current_tenant_id() OR d.user_id = auth.uid())
  ) OR public.is_super_admin()
);

-- driver_positions: same pattern
DROP POLICY IF EXISTS "public all" ON public.driver_positions;

CREATE POLICY "driver_positions_tenant_select" ON public.driver_positions
FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = driver_positions.driver_id
      AND (d.tenant_id = public.current_tenant_id() OR d.user_id = auth.uid())
  ) OR public.is_super_admin()
);

CREATE POLICY "driver_positions_driver_insert" ON public.driver_positions
FOR INSERT TO public
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = driver_positions.driver_id
      AND d.user_id = auth.uid()
  ) OR public.is_super_admin()
);

-- job_stops: scope via parent job's tenant_id
DROP POLICY IF EXISTS "public all" ON public.job_stops;

CREATE POLICY "job_stops_tenant_select" ON public.job_stops
FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = job_stops.job_id
      AND (j.tenant_id = public.current_tenant_id() OR j.tenant_id IS NULL)
  ) OR public.is_super_admin()
);

CREATE POLICY "job_stops_tenant_insert" ON public.job_stops
FOR INSERT TO public
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = job_stops.job_id
      AND j.tenant_id = public.current_tenant_id()
  ) OR public.is_super_admin()
);

CREATE POLICY "job_stops_tenant_update" ON public.job_stops
FOR UPDATE TO public
USING (
  EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = job_stops.job_id
      AND j.tenant_id = public.current_tenant_id()
  ) OR public.is_super_admin()
);

CREATE POLICY "job_stops_tenant_delete" ON public.job_stops
FOR DELETE TO public
USING (
  EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = job_stops.job_id
      AND j.tenant_id = public.current_tenant_id()
  ) OR public.is_super_admin()
);

-- driver_registrations: writes only by service-role; reads only by super admin.
-- (Telegram bot uses service-role via webhook, so no general policy is needed.)
DROP POLICY IF EXISTS "public all" ON public.driver_registrations;

CREATE POLICY "driver_registrations_super_admin_select" ON public.driver_registrations
FOR SELECT TO public
USING (public.is_super_admin());

-- 2) Prevent drivers from changing their own tenant_id (privilege escalation).
DROP POLICY IF EXISTS "tenant_update" ON public.drivers;

CREATE POLICY "tenant_update" ON public.drivers
FOR UPDATE TO public
USING (tenant_id = public.current_tenant_id() OR user_id = auth.uid())
WITH CHECK (
  (
    (current_subscription_status() = ANY (ARRAY['active'::text, 'trial'::text]))
    OR user_id = auth.uid()
  )
  AND (
    -- A driver editing their own row may only keep their existing tenant_id.
    user_id IS DISTINCT FROM auth.uid()
    OR tenant_id IS NOT DISTINCT FROM (
      SELECT d.tenant_id FROM public.drivers d WHERE d.id = drivers.id
    )
  )
);

-- 3) Drop the unused admin_credentials password column and table contents.
--    Passwords are no longer persisted in application code; Supabase Auth
--    is the source of truth.
ALTER TABLE public.admin_credentials DROP COLUMN IF EXISTS password;

-- 4) Fix function search_path warnings (set to 'public').
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
