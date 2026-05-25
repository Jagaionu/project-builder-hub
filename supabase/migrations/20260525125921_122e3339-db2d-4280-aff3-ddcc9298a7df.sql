
-- 1. Stop broadcasting driver_registrations (super-admin only data) via Realtime
ALTER PUBLICATION supabase_realtime DROP TABLE public.driver_registrations;

-- 2. Tighten job_stops SELECT: remove the "tenant_id IS NULL" cross-tenant leak
DROP POLICY IF EXISTS job_stops_tenant_select ON public.job_stops;
CREATE POLICY job_stops_tenant_select ON public.job_stops
FOR SELECT
USING (
  (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_stops.job_id AND j.tenant_id = current_tenant_id()))
  OR is_super_admin()
);

-- 3. Drivers DELETE policy: require active/trial subscription (parity with INSERT/UPDATE)
DROP POLICY IF EXISTS tenant_delete ON public.drivers;
CREATE POLICY tenant_delete ON public.drivers
FOR DELETE
USING (
  tenant_id = current_tenant_id()
  AND current_subscription_status() = ANY (ARRAY['active','trial'])
);

-- 4. Lock down SECURITY DEFINER helpers from anonymous callers.
--    These are used internally by RLS / triggers; authenticated keeps EXECUTE
--    because RLS policies invoke them as the signed-in user.
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_driver_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_subscription_status() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.gen_driver_login_code() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_driver_login_code() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_week_start() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sync_job_for_date() FROM anon, authenticated, public;
