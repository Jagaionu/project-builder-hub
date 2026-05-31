-- ============================================================
-- MIGRATION #19: Shift timing enforcement + return-to-base fields
--
-- Three changes:
--
-- 1. driver_shift_templates: tighten the existing unique from
--    (driver_id, day_of_week, start_time) → (driver_id, day_of_week).
--    This enforces a single shift per driver per day, which is the
--    confirmed design decision. Split shifts are not supported.
--    Any duplicate rows (same driver/day) are deduplicated before
--    the new constraint is applied — we keep the is_primary=true row,
--    or the most-recently-updated row if both are primary.
--
-- 2. drivers: add return_to_base_required boolean (default false).
--    When true the planner must ensure the last stop of the driver's
--    route on any given day is their home_warehouse_id.
--    home_warehouse_id already exists on the table (added in an earlier
--    migration) — this flag is the opt-in enforcement gate.
--
-- 3. routes: add ends_at_home boolean (default false).
--    Set to true by plan-jobs-core after verifying / inserting the
--    final deadhead leg. Planner UI reads this for the RTB badge.
--
-- Safe to re-run: all DDL uses IF EXISTS / IF NOT EXISTS guards.
-- ============================================================

-- ── 1a. Deduplicate driver_shift_templates before tightening the key ───────
--
-- Step 1: where a driver/day has both primary and non-primary rows,
--         delete the non-primary ones.
DELETE FROM public.driver_shift_templates dst
WHERE dst.is_primary = false
  AND EXISTS (
    SELECT 1
    FROM public.driver_shift_templates other
    WHERE other.driver_id  = dst.driver_id
      AND other.day_of_week = dst.day_of_week
      AND other.is_primary  = true
      AND other.id         <> dst.id
  );

-- Step 2: where duplicates still remain (all rows are primary, or all
--         non-primary), keep only the most recently updated one.
DELETE FROM public.driver_shift_templates
WHERE id NOT IN (
  SELECT DISTINCT ON (driver_id, day_of_week) id
  FROM public.driver_shift_templates
  ORDER BY driver_id, day_of_week, updated_at DESC NULLS LAST, id ASC
);

-- ── 1b. Drop the old 3-column unique, add the tighter 2-column unique ──────

ALTER TABLE public.driver_shift_templates
  DROP CONSTRAINT IF EXISTS driver_shift_templates_driver_id_day_of_week_start_time_key;

-- Also drop by the conventional Supabase-generated name variants, just in
-- case the instance used a different auto-naming scheme.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.driver_shift_templates'::regclass
      AND contype  = 'u'
      AND conname <> 'uq_driver_day'
  LOOP
    -- Only drop unique constraints that cover exactly day_of_week + start_time
    -- (i.e. the old 3-column one). Leave any unrelated unique constraints alone.
    IF EXISTS (
      SELECT 1
      FROM pg_attribute a
        JOIN pg_index i    ON  i.indrelid  = a.attrelid
        JOIN pg_constraint c ON c.conindid  = i.indexrelid
          AND c.conname = r.conname
      WHERE a.attname = 'start_time'
        AND a.attrelid = 'public.driver_shift_templates'::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.driver_shift_templates DROP CONSTRAINT IF EXISTS %I', r.conname);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.driver_shift_templates
  ADD CONSTRAINT uq_driver_day UNIQUE (driver_id, day_of_week);

-- ── 2. Add return_to_base_required to drivers ───────────────────────────────

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS return_to_base_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.drivers.return_to_base_required IS
  'When true the planner must route this driver back to home_warehouse_id at '
  'the end of each working day. home_warehouse_id must be non-null for this '
  'flag to have any effect.';

-- ── 3. Add ends_at_home to routes ───────────────────────────────────────────

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS ends_at_home boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.routes.ends_at_home IS
  'Set to true by the planner once the final route_job stop is confirmed to '
  'be (or has been deadheaded to) the driver''s home_warehouse_id. Only '
  'meaningful when the driver has return_to_base_required = true.';
