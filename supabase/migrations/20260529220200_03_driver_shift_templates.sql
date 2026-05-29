-- ============================================================
-- MIGRATION #3: driver_shift_templates (full replacement of driver_shifts)
--
-- DO NOT RUN UNTIL REVIEWED, AND ONLY AFTER APP CODE THAT READS
-- driver_shifts.days_of_week HAS BEEN UPDATED TO READ FROM
-- driver_shift_templates.
--
-- Rationale: driver_shifts stores days_of_week as integer[], one row per
-- driver. That cannot express:
--   • start_time / end_time per day (compliance needs windows)
--   • split shifts (morning + afternoon)
--   • rotating schedules (varying times per day)
--
-- New model: one row per (driver, day_of_week, start_time). UNIQUE on those
-- three columns allows multiple shifts per day. is_primary marks the main
-- window (UI / quick lookups can filter on it).
--
-- Data migration: every existing driver_shifts row is expanded into one
-- row per day in days_of_week with default 06:00–18:00 times. Operators
-- can refine times via the UI afterwards. is_primary defaults to TRUE on
-- the migrated rows.
--
-- The old driver_shifts table is RENAMED to driver_shifts_deprecated, NOT
-- DROPPED. This gives the planner a safety net during the rollout: app
-- code can still query the deprecated table read-only if needed. A future
-- cleanup migration drops it once we're confident.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.driver_shift_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES public.companies(id),
  driver_id     uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  day_of_week   smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    time NOT NULL DEFAULT '06:00',
  end_time      time NOT NULL DEFAULT '18:00',
  is_primary    boolean NOT NULL DEFAULT TRUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- end_time = start_time would be a 24h shift; cleaner to forbid and force
  -- explicit modelling. Overnight shifts (end_time < start_time) are allowed
  -- and interpreted as crossing midnight by the planner.
  CONSTRAINT driver_shift_templates_time_ne CHECK (end_time <> start_time),
  UNIQUE (driver_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_driver_shift_templates_tenant
  ON public.driver_shift_templates (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_shift_templates_lookup
  ON public.driver_shift_templates (driver_id, day_of_week);

-- ── Migrate data: explode days_of_week array into per-day rows ─────────────
-- Guarded by table_exists check so this migration is safe to re-run after
-- the old table is eventually dropped.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'driver_shifts'
  ) THEN
    INSERT INTO public.driver_shift_templates
      (tenant_id, driver_id, day_of_week, start_time, end_time, is_primary)
    SELECT
      ds.tenant_id,
      ds.driver_id,
      d.day::smallint AS day_of_week,
      '06:00'::time   AS start_time,
      '18:00'::time   AS end_time,
      TRUE            AS is_primary
    FROM public.driver_shifts ds
    CROSS JOIN LATERAL unnest(ds.days_of_week) AS d(day)
    WHERE d.day BETWEEN 0 AND 6
    ON CONFLICT (driver_id, day_of_week, start_time) DO NOTHING;
  END IF;
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.driver_shift_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_shift_templates_select ON public.driver_shift_templates;
DROP POLICY IF EXISTS driver_shift_templates_mutate ON public.driver_shift_templates;

CREATE POLICY driver_shift_templates_select ON public.driver_shift_templates
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY driver_shift_templates_mutate ON public.driver_shift_templates
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_shift_templates TO authenticated;
GRANT ALL ON public.driver_shift_templates TO service_role;

-- ── Triggers: tenant sync + updated_at ────────────────────────────────────

DROP TRIGGER IF EXISTS trg_driver_shift_templates_tenant ON public.driver_shift_templates;
CREATE TRIGGER trg_driver_shift_templates_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.driver_shift_templates
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

DROP TRIGGER IF EXISTS driver_shift_templates_touch ON public.driver_shift_templates;
CREATE TRIGGER driver_shift_templates_touch
  BEFORE UPDATE ON public.driver_shift_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Realtime: dispatch UI updates when shifts change ──────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'driver_shift_templates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_shift_templates;
  END IF;
END $$;

-- ── Deprecate the old table (rename, do not drop) ─────────────────────────
-- After app code has been migrated to driver_shift_templates AND has been
-- in production long enough to be confident, a follow-up migration can:
--   DROP TABLE public.driver_shifts_deprecated CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'driver_shifts'
  ) THEN
    ALTER TABLE public.driver_shifts RENAME TO driver_shifts_deprecated;
    -- Mark in pg_description so anyone introspecting the schema sees it.
    COMMENT ON TABLE public.driver_shifts_deprecated IS
      'DEPRECATED. Replaced by driver_shift_templates in migration #3 (2026-05-29). '
      'Kept temporarily as a read-only safety net during rollout. '
      'Safe to DROP after app code is fully migrated and verified.';
  END IF;
END $$;
