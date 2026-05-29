-- ============================================================
-- MIGRATION #8: Partition driver_positions by month (RANGE on created_at)
--
-- ⚠️  REVIEW CAREFULLY — SCHEDULE A SHORT MAINTENANCE WINDOW.
-- ⚠️  This is NOT urgent: it is safe to defer until the table approaches
--     ~1M rows. At 500 drivers × 1 ping / 30s you generate ~1.3M rows/day,
--     so do this BEFORE you onboard fleets at that scale.
--
-- Prerequisites: Migrations #1-#7 applied.
--
-- WHY: a single unpartitioned breadcrumb table becomes unmaintainable at
-- hundreds of millions of rows (vacuum, bloat, index size, retention deletes).
-- Monthly range partitions make retention a cheap DROP/DETACH and keep the
-- hot partition small.
--
-- SAFETY MODEL: the whole swap runs in ONE transaction. Concurrent writers
-- block on the ACCESS EXCLUSIVE lock and then transparently hit the new
-- partitioned table after COMMIT — no rows are lost. The data copy is fast
-- while the table is still small (the whole point of doing it now).
--
-- PARTITION KEY: PostgreSQL requires the partition column to be part of every
-- unique constraint, so the primary key changes from (id) to (id, created_at).
-- Nothing in the schema has a foreign key referencing driver_positions(id),
-- so this is safe.
--
-- ONGOING: this migration pre-creates monthly partitions through 2027-12 plus
-- a DEFAULT catch-all (so inserts never fail). For production, schedule a
-- monthly job (pg_cron) to create next month's partition and DROP partitions
-- older than your retention window. Example at the bottom of this file.
-- ============================================================

BEGIN;

-- 0. GUARD — refuse to run if driver_positions is ALREADY partitioned.
--    Re-running would rename the live partitioned table to _old, create a
--    fresh empty parent, then fail to recreate the partitions (their names
--    already exist on _old) — leaving an empty, partition-less table. The
--    EXCEPTION aborts the transaction before any destructive step.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'driver_positions'
      AND c.relnamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION
      'Migration #8 already applied: public.driver_positions is already '
      'partitioned. Do NOT re-run — re-running renames the live table and '
      'drops its partitions. (If a previous run half-finished, use the '
      'recovery script instead.)';
  END IF;
END $$;

-- 1. Rename the live table out of the way.
ALTER TABLE public.driver_positions RENAME TO driver_positions_old;

-- 2. Create the partitioned parent with the same columns.
--    PK includes created_at (required for range partitioning).
CREATE TABLE public.driver_positions (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  driver_id   uuid        NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  lat         double precision NOT NULL,
  lon         double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  tenant_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 3. Monthly partitions for 2026-01 .. 2027-12, plus a DEFAULT catch-all.
DO $$
DECLARE
  d_start date := date '2026-01-01';
  d_end   date := date '2028-01-01';
  d       date := d_start;
  part    text;
BEGIN
  WHILE d < d_end LOOP
    part := 'driver_positions_' || to_char(d, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.driver_positions '
      'FOR VALUES FROM (%L) TO (%L)',
      part, d::timestamptz, (d + interval '1 month')::timestamptz
    );
    d := d + interval '1 month';
  END LOOP;

  -- Anything outside the explicit range lands here so inserts never fail.
  EXECUTE 'CREATE TABLE IF NOT EXISTS public.driver_positions_default '
          'PARTITION OF public.driver_positions DEFAULT';
END $$;

-- 4. Copy existing data (fast while small).
INSERT INTO public.driver_positions (id, driver_id, lat, lon, created_at, tenant_id)
SELECT id, driver_id, lat, lon, created_at, tenant_id
FROM public.driver_positions_old;

-- 5. Recreate indexes (created on the parent → propagate to all partitions).
CREATE INDEX IF NOT EXISTS idx_driver_positions_driver_time
  ON public.driver_positions (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_positions_tenant_driver_time
  ON public.driver_positions (tenant_id, driver_id, created_at DESC);

-- 6. Re-enable RLS and recreate the policies from migration #2.
ALTER TABLE public.driver_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_positions_select ON public.driver_positions;
DROP POLICY IF EXISTS driver_positions_mutate ON public.driver_positions;

CREATE POLICY driver_positions_select ON public.driver_positions
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY driver_positions_mutate ON public.driver_positions
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

-- 7. Recreate the tenant-sync trigger (fills tenant_id from the driver).
DROP TRIGGER IF EXISTS trg_driver_positions_tenant ON public.driver_positions;
CREATE TRIGGER trg_driver_positions_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.driver_positions
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

-- 8. Grants (match the rest of the schema).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_positions TO authenticated;
GRANT ALL ON public.driver_positions TO service_role;

-- 9. Drop the old table now that data is copied.
DROP TABLE public.driver_positions_old;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- ONGOING MAINTENANCE (run separately — requires the pg_cron extension).
-- Pre-create next month's partition and drop partitions past retention.
-- Adjust the 90-day retention to your needs.
-- ════════════════════════════════════════════════════════════════════
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
--
-- CREATE OR REPLACE FUNCTION public.maintain_driver_positions_partitions()
-- RETURNS void LANGUAGE plpgsql AS $$
-- DECLARE
--   nxt  date := date_trunc('month', now())::date + interval '1 month';
--   part text := 'driver_positions_' || to_char(nxt, 'YYYY_MM');
--   old  record;
-- BEGIN
--   EXECUTE format(
--     'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.driver_positions '
--     'FOR VALUES FROM (%L) TO (%L)',
--     part, nxt::timestamptz, (nxt + interval '1 month')::timestamptz);
--
--   FOR old IN
--     SELECT c.relname
--     FROM pg_inherits i
--     JOIN pg_class c     ON c.oid = i.inhrelid
--     JOIN pg_class p     ON p.oid = i.inhparent
--     WHERE p.relname = 'driver_positions'
--       AND c.relname ~ '^driver_positions_[0-9]{4}_[0-9]{2}$'
--       AND to_date(right(c.relname, 7), 'YYYY_MM') < (now() - interval '90 days')
--   LOOP
--     EXECUTE format('DROP TABLE IF EXISTS public.%I', old.relname);
--   END LOOP;
-- END $$;
--
-- SELECT cron.schedule('driver-positions-partitions', '0 2 1 * *',
--                      $$ SELECT public.maintain_driver_positions_partitions(); $$);
