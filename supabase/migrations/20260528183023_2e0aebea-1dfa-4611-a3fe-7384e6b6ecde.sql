-- ============================================================
-- MIGRATION: warehouse_global_scope
--
-- Problem: When a super admin adds a warehouse from the admin panel
-- it is inserted with tenant_id = NULL (global / shared). The existing
-- INSERT policy requires tenant_id = current_tenant_id(), so the insert
-- is rejected. Additionally, NULL-tenant warehouses are invisible to
-- company users because the SELECT policy has no IS NULL branch.
--
-- Fix:
--  1. Drop the global UNIQUE constraint on `code` — it blocks companies
--     from having their own warehouse with the same code as a global one.
--  2. Add two partial unique indexes instead:
--     • global codes (tenant_id IS NULL) must be unique across globals
--     • per-tenant codes (tenant_id NOT NULL) must be unique within each tenant
--  3. Replace all four warehouse RLS policies with corrected versions:
--     SELECT  — tenant rows + global (NULL) rows + super-admin sees all
--     INSERT  — super admin can insert with any tenant_id incl. NULL;
--               company users insert only their own tenant
--     UPDATE  — super admin can edit global rows; companies edit their own
--     DELETE  — super admin can delete global rows; companies delete their own
-- ============================================================

-- ── 1. Fix UNIQUE constraint ───────────────────────────────────────────────

-- Drop the single global UNIQUE on code (created by the initial migration).
ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS warehouses_code_key;

-- Global warehouses: code must be unique among globals (tenant_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_global_code_unique
  ON public.warehouses (upper(code))
  WHERE tenant_id IS NULL;

-- Per-tenant warehouses: code must be unique within each tenant.
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_tenant_code_unique
  ON public.warehouses (upper(code), tenant_id)
  WHERE tenant_id IS NOT NULL;

-- ── 2. Replace warehouse RLS policies ─────────────────────────────────────

DROP POLICY IF EXISTS "tenant_select" ON public.warehouses;
DROP POLICY IF EXISTS "tenant_insert" ON public.warehouses;
DROP POLICY IF EXISTS "tenant_update" ON public.warehouses;
DROP POLICY IF EXISTS "tenant_delete" ON public.warehouses;

-- SELECT: own-tenant rows + all global (NULL tenant) rows + super-admin sees all
CREATE POLICY "warehouse_select" ON public.warehouses
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    OR tenant_id IS NULL
    OR public.is_super_admin()
  );

-- INSERT:
--   • Super admin → any row, including tenant_id = NULL (global) or any specific tenant
--   • Company user → only rows belonging to their own active/trial tenant
CREATE POLICY "warehouse_insert" ON public.warehouses
  FOR INSERT WITH CHECK (
    public.is_super_admin()
    OR (
      tenant_id = public.current_tenant_id()
      AND public.current_subscription_status() IN ('active', 'trial')
    )
  );

-- UPDATE:
--   • Super admin → can edit global (NULL tenant) rows or their own tenant rows
--   • Company user → only their own tenant rows (subscription must be active/trial)
CREATE POLICY "warehouse_update" ON public.warehouses
  FOR UPDATE
  USING (
    (public.is_super_admin() AND (tenant_id IS NULL OR tenant_id = public.current_tenant_id()))
    OR tenant_id = public.current_tenant_id()
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.current_subscription_status() IN ('active', 'trial')
  );

-- DELETE:
--   • Super admin → can delete global (NULL tenant) rows
--   • Company user → can delete their own tenant rows (not global ones)
CREATE POLICY "warehouse_delete" ON public.warehouses
  FOR DELETE USING (
    (public.is_super_admin() AND tenant_id IS NULL)
    OR tenant_id = public.current_tenant_id()
  );
