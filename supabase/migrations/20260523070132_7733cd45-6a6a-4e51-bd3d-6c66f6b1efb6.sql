DROP POLICY IF EXISTS tenant_select ON public.warehouses;

CREATE POLICY tenant_select ON public.warehouses
FOR SELECT
USING (
  tenant_id = current_tenant_id()
  OR tenant_id IS NULL
  OR is_super_admin()
);