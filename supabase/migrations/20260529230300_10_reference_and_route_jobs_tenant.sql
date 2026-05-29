-- ============================================================
-- MIGRATION #10: Per-tenant job reference + route_jobs.tenant_id denormalize
--
-- DO NOT RUN UNTIL REVIEWED.
-- Prerequisites: Migrations #1-#7 applied (needs jobs.tenant_id NOT NULL).
--
-- Addresses the two genuinely-new, safe items from the latest review:
--
--   #3  jobs.reference is GLOBALLY unique today. In a multi-tenant system two
--       different companies can legitimately use the same customer reference
--       (e.g. "ORDER-1001"). A global UNIQUE makes the second tenant's import
--       fail. Switch to per-tenant uniqueness (tenant_id, reference).
--       (Relaxing global → per-tenant can never violate existing data, since
--        existing rows were already globally unique.)
--
--   #8  route_jobs has no tenant_id; its RLS must join through routes. The
--       table is currently EMPTY (scaffold), so denormalizing tenant_id now is
--       free. We add the column + FK + sync trigger + index, give RLS a direct
--       fast-path, and keep the route-join branch so driver visibility and
--       soft-delete semantics are preserved.
--
-- Also includes the LOW-priority partial "active record" indexes for drivers
-- and warehouses (review item #13).
-- ============================================================

-- ════════════════════════════════════════════════════════════════════
-- 1.  jobs.reference → per-tenant UNIQUE
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_con text;
BEGIN
  -- Find and drop any SINGLE-column UNIQUE constraint on jobs(reference),
  -- whatever its auto-generated name is (usually jobs_reference_key).
  SELECT c.conname INTO v_con
  FROM pg_constraint c
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.jobs'::regclass
    AND c.contype = 'u'
    AND array_length(c.conkey, 1) = 1
    AND a.attname = 'reference'
  LIMIT 1;

  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.jobs DROP CONSTRAINT %I', v_con);
    RAISE NOTICE 'Migration #10: dropped global unique constraint % on jobs.reference', v_con;
  ELSE
    RAISE NOTICE 'Migration #10: no single-column unique on jobs.reference found (already per-tenant?)';
  END IF;
END $$;

-- Add the per-tenant unique (idempotent via name check).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_tenant_reference_uniq'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_tenant_reference_uniq UNIQUE (tenant_id, reference);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 2.  route_jobs.tenant_id (denormalized from parent route)
-- ════════════════════════════════════════════════════════════════════

-- 2a. Column (nullable first), FK to companies.
ALTER TABLE public.route_jobs
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

-- 2b. Backfill from the parent route (route_jobs is empty today, so this is a
--     no-op now, but keeps the migration correct if rows already exist).
UPDATE public.route_jobs rj
SET tenant_id = r.tenant_id
FROM public.routes r
WHERE rj.route_id = r.id
  AND rj.tenant_id IS NULL;

-- 2c. Sync trigger: fill tenant_id from the route on insert / route change.
CREATE OR REPLACE FUNCTION public.sync_tenant_from_route()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.route_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.routes WHERE id = NEW.route_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_jobs_tenant ON public.route_jobs;
CREATE TRIGGER trg_route_jobs_tenant
  BEFORE INSERT OR UPDATE OF route_id ON public.route_jobs
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_route();

-- 2d. Enforce NOT NULL (safe: empty table, and backfill above covered any rows).
DO $$
DECLARE
  v_null bigint;
BEGIN
  SELECT count(*) INTO v_null FROM public.route_jobs WHERE tenant_id IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'Migration #10 aborted: % route_jobs rows have NULL tenant_id '
      '(orphaned route?). Investigate before enforcing NOT NULL.', v_null;
  END IF;
  ALTER TABLE public.route_jobs ALTER COLUMN tenant_id SET NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_route_jobs_tenant
  ON public.route_jobs (tenant_id, route_id);

-- 2e. RLS: add a direct tenant fast-path, keep the route-join branch for
--     driver visibility + soft-delete semantics.
DROP POLICY IF EXISTS route_jobs_select ON public.route_jobs;
DROP POLICY IF EXISTS route_jobs_mutate ON public.route_jobs;

CREATE POLICY route_jobs_select ON public.route_jobs
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.routes r
      WHERE r.id = route_jobs.route_id
        AND r.deleted_at IS NULL
        AND r.driver_id = public.current_driver_id()
    )
  );

CREATE POLICY route_jobs_mutate ON public.route_jobs
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- ════════════════════════════════════════════════════════════════════
-- 3.  Partial "active record" indexes (review item #13)
-- ════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_drivers_tenant_active
  ON public.drivers (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_active
  ON public.warehouses (tenant_id)
  WHERE deleted_at IS NULL;
