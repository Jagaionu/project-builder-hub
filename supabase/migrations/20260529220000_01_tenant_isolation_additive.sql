-- ============================================================
-- MIGRATION #1: Tenant Isolation (Additive)
--
-- DO NOT RUN UNTIL REVIEWED.
--
-- Adds NULLABLE tenant_id to every tenant-owned table that is
-- missing it. Backfills from related driver/job rows. Does NOT
-- flip NOT NULL or enable strict RLS yet — that comes in
-- Migration #2 after we verify backfill in production.
--
-- Tables affected:
--   driver_shifts                 (backfill from drivers)
--   driver_availability_overrides (backfill from drivers)
--   driver_day_hours              (backfill from drivers)
--   driver_positions              (backfill from drivers)
--   driving_legs                  (backfill from drivers)
--   stop_dwells                   (backfill from drivers)
--   job_stops                     (backfill from jobs)
--   driver_events                 (column exists but nullable; backfill NULL rows)
--
-- Every step is idempotent (IF NOT EXISTS / WHERE col IS NULL).
-- Safe to re-run.
-- ============================================================

-- ── driver_shifts ──────────────────────────────────────────────────────────
ALTER TABLE public.driver_shifts
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.companies(id);

UPDATE public.driver_shifts ds
SET tenant_id = d.tenant_id
FROM public.drivers d
WHERE ds.driver_id = d.id
  AND ds.tenant_id IS NULL
  AND d.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_driver_shifts_tenant
  ON public.driver_shifts (tenant_id, driver_id);

-- ── driver_availability_overrides ──────────────────────────────────────────
ALTER TABLE public.driver_availability_overrides
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.companies(id);

UPDATE public.driver_availability_overrides ao
SET tenant_id = d.tenant_id
FROM public.drivers d
WHERE ao.driver_id = d.id
  AND ao.tenant_id IS NULL
  AND d.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_driver_availability_overrides_tenant
  ON public.driver_availability_overrides (tenant_id, driver_id, date);

-- ── driver_day_hours ───────────────────────────────────────────────────────
-- Already has UNIQUE(driver_id, day) and idx_ddh_driver_day; we only add
-- tenant_id + a tenant-aware composite index for planner queries.
ALTER TABLE public.driver_day_hours
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.companies(id);

UPDATE public.driver_day_hours dh
SET tenant_id = d.tenant_id
FROM public.drivers d
WHERE dh.driver_id = d.id
  AND dh.tenant_id IS NULL
  AND d.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_driver_day_hours_tenant
  ON public.driver_day_hours (tenant_id, driver_id, day);

-- ── driver_positions ───────────────────────────────────────────────────────
-- Already has idx_driver_positions_driver_time; add tenant_id + tenant index.
ALTER TABLE public.driver_positions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.companies(id);

UPDATE public.driver_positions dp
SET tenant_id = d.tenant_id
FROM public.drivers d
WHERE dp.driver_id = d.id
  AND dp.tenant_id IS NULL
  AND d.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_driver_positions_tenant_driver_time
  ON public.driver_positions (tenant_id, driver_id, created_at DESC);

-- ── driving_legs ───────────────────────────────────────────────────────────
-- Already has driving_legs_driver_date_idx; add tenant_id + tenant index.
ALTER TABLE public.driving_legs
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.companies(id);

UPDATE public.driving_legs dl
SET tenant_id = d.tenant_id
FROM public.drivers d
WHERE dl.driver_id = d.id
  AND dl.tenant_id IS NULL
  AND d.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_driving_legs_tenant
  ON public.driving_legs (tenant_id, driver_id, leg_date);

-- ── stop_dwells ────────────────────────────────────────────────────────────
-- Already has stop_dwells_driver_date_idx; add tenant_id and the
-- warehouse-centric index from the senior review (used for delay profiling).
ALTER TABLE public.stop_dwells
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.companies(id);

UPDATE public.stop_dwells sd
SET tenant_id = d.tenant_id
FROM public.drivers d
WHERE sd.driver_id = d.id
  AND sd.tenant_id IS NULL
  AND d.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stop_dwells_tenant
  ON public.stop_dwells (tenant_id, warehouse_id, dwell_date);
CREATE INDEX IF NOT EXISTS idx_stop_dwells_warehouse_date
  ON public.stop_dwells (warehouse_id, dwell_date);

-- ── job_stops ──────────────────────────────────────────────────────────────
ALTER TABLE public.job_stops
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.companies(id);

UPDATE public.job_stops js
SET tenant_id = j.tenant_id
FROM public.jobs j
WHERE js.job_id = j.id
  AND js.tenant_id IS NULL
  AND j.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_stops_tenant
  ON public.job_stops (tenant_id, job_id);

-- ── driver_events ──────────────────────────────────────────────────────────
-- tenant_id column exists but allows NULL. Backfill remaining NULL rows.
UPDATE public.driver_events de
SET tenant_id = d.tenant_id
FROM public.drivers d
WHERE de.driver_id = d.id
  AND de.tenant_id IS NULL
  AND d.tenant_id IS NOT NULL;

-- Composite index for planner's compliance scan (driver_id + timestamp window
-- filtered by tenant). idx_driver_events_driver and idx_driver_events_tenant
-- already exist; we add the 3-column composite for time-range scans.
CREATE INDEX IF NOT EXISTS idx_driver_events_tenant_driver_time
  ON public.driver_events (tenant_id, driver_id, timestamp);

-- ── jobs: planner composite index ─────────────────────────────────────────
-- Senior review Section 3 — most planner SELECTs filter
-- (tenant_id, status, for_date) so a single composite is decisive.
CREATE INDEX IF NOT EXISTS idx_jobs_planning
  ON public.jobs (tenant_id, status, for_date, planned_sequence);

-- ── Trigger: keep tenant_id in sync going forward ──────────────────────────
-- Inserts that forget tenant_id will silently fill it from the related
-- driver / job. Prevents future orphans without forcing every server function
-- to remember the column.

CREATE OR REPLACE FUNCTION public.sync_tenant_from_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.driver_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.drivers WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_tenant_from_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.job_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.jobs WHERE id = NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_shifts_tenant ON public.driver_shifts;
CREATE TRIGGER trg_driver_shifts_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.driver_shifts
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

DROP TRIGGER IF EXISTS trg_driver_availability_overrides_tenant ON public.driver_availability_overrides;
CREATE TRIGGER trg_driver_availability_overrides_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.driver_availability_overrides
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

DROP TRIGGER IF EXISTS trg_driver_day_hours_tenant ON public.driver_day_hours;
CREATE TRIGGER trg_driver_day_hours_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.driver_day_hours
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

DROP TRIGGER IF EXISTS trg_driver_positions_tenant ON public.driver_positions;
CREATE TRIGGER trg_driver_positions_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.driver_positions
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

DROP TRIGGER IF EXISTS trg_driving_legs_tenant ON public.driving_legs;
CREATE TRIGGER trg_driving_legs_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.driving_legs
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

DROP TRIGGER IF EXISTS trg_stop_dwells_tenant ON public.stop_dwells;
CREATE TRIGGER trg_stop_dwells_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.stop_dwells
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

DROP TRIGGER IF EXISTS trg_driver_events_tenant ON public.driver_events;
CREATE TRIGGER trg_driver_events_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.driver_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

DROP TRIGGER IF EXISTS trg_job_stops_tenant ON public.job_stops;
CREATE TRIGGER trg_job_stops_tenant
  BEFORE INSERT OR UPDATE OF job_id ON public.job_stops
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_job();

-- ── Sanity check ───────────────────────────────────────────────────────────
-- Logs (does not fail) any row that could not be backfilled. The real
-- enforcement comes in Migration #2 / a later NOT NULL cleanup.

DO $$
DECLARE
  v_table text;
  v_count bigint;
BEGIN
  FOR v_table, v_count IN
    SELECT 'driver_shifts',                 count(*) FROM public.driver_shifts                 WHERE tenant_id IS NULL
    UNION ALL
    SELECT 'driver_availability_overrides', count(*) FROM public.driver_availability_overrides WHERE tenant_id IS NULL
    UNION ALL
    SELECT 'driver_day_hours',              count(*) FROM public.driver_day_hours              WHERE tenant_id IS NULL
    UNION ALL
    SELECT 'driver_positions',              count(*) FROM public.driver_positions              WHERE tenant_id IS NULL
    UNION ALL
    SELECT 'driving_legs',                  count(*) FROM public.driving_legs                  WHERE tenant_id IS NULL
    UNION ALL
    SELECT 'stop_dwells',                   count(*) FROM public.stop_dwells                   WHERE tenant_id IS NULL
    UNION ALL
    SELECT 'job_stops',                     count(*) FROM public.job_stops                     WHERE tenant_id IS NULL
    UNION ALL
    SELECT 'driver_events',                 count(*) FROM public.driver_events                 WHERE tenant_id IS NULL
  LOOP
    IF v_count > 0 THEN
      RAISE NOTICE 'Migration #1: % rows in %.tenant_id remain NULL — investigate (orphaned driver or driver with NULL tenant_id)', v_count, v_table;
    END IF;
  END LOOP;
END $$;
