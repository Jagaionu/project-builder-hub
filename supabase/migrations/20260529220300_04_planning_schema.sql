-- ============================================================
-- MIGRATION #4: New Planning Schema (scaffold)
--
-- DO NOT RUN UNTIL REVIEWED.
-- Prerequisites: Migrations #1-#3 applied.
--
-- This migration creates the new planning primitives recommended in
-- Sections 4-7 of the senior review. These tables are CREATED EMPTY
-- (dormant scaffold) — nothing reads from them yet. Application code
-- will migrate to them in subsequent commits without breaking the
-- existing planner.
--
-- New tables:
--   routes                     — actual executed plans (per driver, per day)
--   route_jobs                 — ordered stops + deadhead legs on a route
--   driver_daily_compliance    — per-day legal limits (driving / work / break)
--   lane_travel_times          — historical lane performance for dynamic ETA
--   warehouse_dwell_profiles   — historical dwell times per warehouse / time-of-day
--   warehouse_hours            — warehouse opening hours per day-of-week
--   audit_planning_log         — immutable audit trail of planning decisions
--   planning_queue             — event queue for async planner triggers
--
-- New columns:
--   jobs.earliest_start         — customer-required earliest pickup time
--   jobs.latest_end             — customer-required latest delivery time
--   jobs.deleted_at             — soft delete
--   drivers.home_warehouse_id   — driver home base (end-of-day return optimization)
--   drivers.deleted_at          — soft delete
--   warehouses.geofence_radius_meters — for arrival/departure detection
--   warehouses.deleted_at       — soft delete
--
-- RLS: every tenant-scoped table mirrors the import_batches pattern.
-- audit_planning_log is INSERT-ONLY for authenticated users (no UPDATE/DELETE).
-- planning_queue is service-role only.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════
-- 1.  Column additions on existing tables
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS earliest_start timestamptz,
  ADD COLUMN IF NOT EXISTS latest_end     timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at     timestamptz;

CREATE INDEX IF NOT EXISTS idx_jobs_time_window
  ON public.jobs (tenant_id, earliest_start, latest_end)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_active
  ON public.jobs (tenant_id, status, for_date)
  WHERE deleted_at IS NULL;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS home_warehouse_id uuid REFERENCES public.warehouses(id),
  ADD COLUMN IF NOT EXISTS deleted_at        timestamptz;

CREATE INDEX IF NOT EXISTS idx_drivers_home_warehouse
  ON public.drivers (home_warehouse_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS deleted_at             timestamptz;

-- Optional PostGIS geofence index — added best-effort. If PostGIS is not
-- enabled on this Supabase project the DO block silently skips it and the
-- planner falls back to in-app haversine distance checks (which still work).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_warehouses_geofence '
            'ON public.warehouses USING GIST '
            '(geography(ST_MakePoint(longitude, latitude)))';
  ELSE
    RAISE NOTICE 'Migration #4: PostGIS not enabled — skipping geofence GIST index. App-side haversine still works.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Migration #4: could not create PostGIS geofence index (%); continuing.', SQLERRM;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 2.  routes  +  route_jobs
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.routes (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id                       uuid NOT NULL REFERENCES public.drivers(id),
  route_date                      date NOT NULL,
  planned_start_at                timestamptz,
  planned_end_at                  timestamptz,
  actual_start_at                 timestamptz,
  actual_end_at                   timestamptz,
  total_planned_driving_minutes   integer,
  total_planned_deadhead_minutes  integer,
  total_planned_km                double precision,
  total_actual_driving_minutes    integer,
  total_actual_km                 double precision,
  status                          text NOT NULL DEFAULT 'planned'
                                  CHECK (status IN ('planned', 'active', 'completed', 'aborted')),
  -- Versioning: when the planner re-runs and produces a different assignment
  -- for the same (driver, date), the previous route is moved to status='aborted'
  -- and a new row is inserted. This gives a full audit trail.
  version                         integer NOT NULL DEFAULT 1,
  planner_run_id                  uuid,
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  deleted_at                      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_routes_tenant_date
  ON public.routes (tenant_id, route_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_routes_driver_date
  ON public.routes (driver_id, route_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_routes_status
  ON public.routes (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.route_jobs (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id                        uuid NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  job_id                          uuid REFERENCES public.jobs(id),
  stop_sequence                   integer NOT NULL,
  planned_arrival                 timestamptz,
  planned_departure               timestamptz,
  actual_arrival                  timestamptz,
  actual_departure                timestamptz,
  -- A route entry that is not a job is a deadhead (empty-truck repositioning).
  is_deadhead                     boolean NOT NULL DEFAULT FALSE,
  deadhead_from_warehouse_id      uuid REFERENCES public.warehouses(id),
  deadhead_to_warehouse_id        uuid REFERENCES public.warehouses(id),
  deadhead_km                     double precision,
  deadhead_minutes                integer,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, stop_sequence),
  -- Either it's a real job stop OR a deadhead leg; never both, never neither.
  CONSTRAINT route_jobs_kind_check CHECK (
    (is_deadhead = FALSE AND job_id IS NOT NULL)
    OR
    (is_deadhead = TRUE  AND deadhead_from_warehouse_id IS NOT NULL AND deadhead_to_warehouse_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_route_jobs_route   ON public.route_jobs (route_id, stop_sequence);
CREATE INDEX IF NOT EXISTS idx_route_jobs_job     ON public.route_jobs (job_id) WHERE job_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- 3.  driver_daily_compliance  (per-day rule snapshot)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.driver_daily_compliance (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id                uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  date                     date NOT NULL,
  shift_start              time,
  shift_end                time,
  max_drive_minutes        integer NOT NULL DEFAULT 540,   -- 9h
  max_work_minutes         integer NOT NULL DEFAULT 780,   -- 13h
  required_break_minutes   integer NOT NULL DEFAULT 30,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, date)
);

CREATE INDEX IF NOT EXISTS idx_driver_daily_compliance_tenant
  ON public.driver_daily_compliance (tenant_id, date);

-- ════════════════════════════════════════════════════════════════════
-- 4.  lane_travel_times  +  warehouse_dwell_profiles
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lane_travel_times (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  from_warehouse_id        uuid NOT NULL REFERENCES public.warehouses(id),
  to_warehouse_id          uuid NOT NULL REFERENCES public.warehouses(id),
  day_of_week              smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  hour_of_day              smallint NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  avg_duration_minutes     integer,
  p50_duration_minutes     integer,
  p90_duration_minutes     integer,
  sample_count             integer NOT NULL DEFAULT 0,
  last_updated             timestamptz NOT NULL DEFAULT now(),
  -- tenant_id NULL means the lane statistics are global (cross-tenant); each
  -- tenant can also have its own override. The planner prefers tenant-specific.
  UNIQUE NULLS NOT DISTINCT (tenant_id, from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day)
);

CREATE INDEX IF NOT EXISTS idx_lane_travel_times_lookup
  ON public.lane_travel_times (from_warehouse_id, to_warehouse_id, day_of_week, hour_of_day);

CREATE TABLE IF NOT EXISTS public.warehouse_dwell_profiles (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  warehouse_id             uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  day_of_week              smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  hour_of_day              smallint NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  kind                     text NOT NULL CHECK (kind IN ('PICKUP', 'DROP')),
  avg_dwell_minutes        integer,
  p90_dwell_minutes        integer,
  sample_count             integer NOT NULL DEFAULT 0,
  last_updated             timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, warehouse_id, day_of_week, hour_of_day, kind)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_dwell_profiles_lookup
  ON public.warehouse_dwell_profiles (warehouse_id, day_of_week, hour_of_day, kind);

-- ════════════════════════════════════════════════════════════════════
-- 5.  warehouse_hours  (operating window per day-of-week)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.warehouse_hours (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id  uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  day_of_week   smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time     time NOT NULL,
  close_time    time NOT NULL,
  is_closed     boolean NOT NULL DEFAULT FALSE,   -- explicit "closed all day"
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_hours_lookup
  ON public.warehouse_hours (warehouse_id, day_of_week);

-- ════════════════════════════════════════════════════════════════════
-- 6.  audit_planning_log  (immutable decision history)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_planning_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type       text NOT NULL CHECK (entity_type IN ('job', 'route', 'route_job', 'driver_assignment', 'plan_run')),
  entity_id         uuid NOT NULL,
  action            text NOT NULL,
  old_value         jsonb,
  new_value         jsonb,
  planner_user_id   uuid REFERENCES auth.users(id),
  driver_id         uuid REFERENCES public.drivers(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_planning_log_entity
  ON public.audit_planning_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_planning_log_tenant_time
  ON public.audit_planning_log (tenant_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════
-- 7.  planning_queue  (event queue for async recalc)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.planning_queue (
  id              bigserial PRIMARY KEY,
  event_type      text NOT NULL,
  tenant_id       uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority        smallint NOT NULL DEFAULT 5,    -- 0 = highest, 9 = lowest
  attempts        smallint NOT NULL DEFAULT 0,
  last_error      text,
  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  processing_at   timestamptz,
  processed_at    timestamptz,
  worker_id       text
);

-- Partial index on unprocessed rows — the worker only pulls these.
CREATE INDEX IF NOT EXISTS idx_planning_queue_unprocessed
  ON public.planning_queue (priority, enqueued_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_planning_queue_tenant
  ON public.planning_queue (tenant_id, enqueued_at DESC);

-- ════════════════════════════════════════════════════════════════════
-- 8.  RLS policies
-- ════════════════════════════════════════════════════════════════════

-- ── routes ─────────────────────────────────────────────────────────────────
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS routes_select ON public.routes;
DROP POLICY IF EXISTS routes_mutate ON public.routes;

CREATE POLICY routes_select ON public.routes
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY routes_mutate ON public.routes
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- ── route_jobs (tenant via parent route) ─────────────────────────────────
ALTER TABLE public.route_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS route_jobs_select ON public.route_jobs;
DROP POLICY IF EXISTS route_jobs_mutate ON public.route_jobs;

CREATE POLICY route_jobs_select ON public.route_jobs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.routes r
      WHERE r.id = route_jobs.route_id
        AND r.deleted_at IS NULL
        AND (
          r.tenant_id = public.current_tenant_id()
          OR public.is_super_admin()
          OR r.driver_id = public.current_driver_id()
        )
    )
  );

CREATE POLICY route_jobs_mutate ON public.route_jobs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.routes r
      WHERE r.id = route_jobs.route_id
        AND r.deleted_at IS NULL
        AND (r.tenant_id = public.current_tenant_id() OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.routes r
      WHERE r.id = route_jobs.route_id
        AND r.deleted_at IS NULL
        AND (r.tenant_id = public.current_tenant_id() OR public.is_super_admin())
    )
  );

-- ── driver_daily_compliance ──────────────────────────────────────────────
ALTER TABLE public.driver_daily_compliance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_daily_compliance_select ON public.driver_daily_compliance;
DROP POLICY IF EXISTS driver_daily_compliance_mutate ON public.driver_daily_compliance;

CREATE POLICY driver_daily_compliance_select ON public.driver_daily_compliance
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY driver_daily_compliance_mutate ON public.driver_daily_compliance
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- ── lane_travel_times ─────────────────────────────────────────────────────
ALTER TABLE public.lane_travel_times ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lane_travel_times_select ON public.lane_travel_times;
DROP POLICY IF EXISTS lane_travel_times_mutate ON public.lane_travel_times;

CREATE POLICY lane_travel_times_select ON public.lane_travel_times
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR tenant_id IS NULL          -- global lane stats visible to all
    OR public.is_super_admin()
  );

CREATE POLICY lane_travel_times_mutate ON public.lane_travel_times
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- ── warehouse_dwell_profiles ─────────────────────────────────────────────
ALTER TABLE public.warehouse_dwell_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_dwell_profiles_select ON public.warehouse_dwell_profiles;
DROP POLICY IF EXISTS warehouse_dwell_profiles_mutate ON public.warehouse_dwell_profiles;

CREATE POLICY warehouse_dwell_profiles_select ON public.warehouse_dwell_profiles
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR tenant_id IS NULL
    OR public.is_super_admin()
  );

CREATE POLICY warehouse_dwell_profiles_mutate ON public.warehouse_dwell_profiles
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- ── warehouse_hours (no tenant_id; inherits warehouse tenant via join) ───
ALTER TABLE public.warehouse_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_hours_select ON public.warehouse_hours;
DROP POLICY IF EXISTS warehouse_hours_mutate ON public.warehouse_hours;

CREATE POLICY warehouse_hours_select ON public.warehouse_hours
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = warehouse_hours.warehouse_id
        AND (w.tenant_id = public.current_tenant_id() OR w.tenant_id IS NULL OR public.is_super_admin())
    )
  );

CREATE POLICY warehouse_hours_mutate ON public.warehouse_hours
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = warehouse_hours.warehouse_id
        AND (w.tenant_id = public.current_tenant_id() OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.warehouses w
      WHERE w.id = warehouse_hours.warehouse_id
        AND (w.tenant_id = public.current_tenant_id() OR public.is_super_admin())
    )
  );

-- ── audit_planning_log: INSERT-only for authenticated, SELECT scoped ────
ALTER TABLE public.audit_planning_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_planning_log_select ON public.audit_planning_log;
DROP POLICY IF EXISTS audit_planning_log_insert ON public.audit_planning_log;

CREATE POLICY audit_planning_log_select ON public.audit_planning_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

CREATE POLICY audit_planning_log_insert ON public.audit_planning_log
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- Explicitly DO NOT create UPDATE/DELETE policies — audit log is immutable.
-- (RLS denies by default when no matching policy exists.)

-- ── planning_queue: service-role only by default ─────────────────────────
ALTER TABLE public.planning_queue ENABLE ROW LEVEL SECURITY;
-- No policies → no rows visible to authenticated users. Server functions
-- using the service-role key can read/write freely.

-- ════════════════════════════════════════════════════════════════════
-- 9.  Triggers
-- ════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS routes_touch ON public.routes;
CREATE TRIGGER routes_touch
  BEFORE UPDATE ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Tenant-sync triggers for routes (and via cascade for route_jobs)
DROP TRIGGER IF EXISTS trg_routes_tenant ON public.routes;
CREATE TRIGGER trg_routes_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

-- Audit trigger: every change to jobs.assigned_driver_id is logged.
CREATE OR REPLACE FUNCTION public.log_job_driver_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.assigned_driver_id IS DISTINCT FROM NEW.assigned_driver_id THEN
    INSERT INTO public.audit_planning_log
      (tenant_id, entity_type, entity_id, action, old_value, new_value, planner_user_id, driver_id)
    VALUES (
      NEW.tenant_id,
      'job',
      NEW.id,
      'assign_driver',
      jsonb_build_object('driver_id', OLD.assigned_driver_id, 'status', OLD.status),
      jsonb_build_object('driver_id', NEW.assigned_driver_id, 'status', NEW.status),
      auth.uid(),
      NEW.assigned_driver_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_job_driver ON public.jobs;
CREATE TRIGGER trg_audit_job_driver
  AFTER UPDATE OF assigned_driver_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.log_job_driver_assignment();

-- ════════════════════════════════════════════════════════════════════
-- 10.  Realtime publication for routes (dispatch UI subscribes)
-- ════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'routes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.routes;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'route_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.route_jobs;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 11.  GRANTs (matches existing table grants in the codebase)
-- ════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON public.routes                    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_jobs                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_daily_compliance   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lane_travel_times         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_dwell_profiles  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_hours           TO authenticated;
GRANT SELECT, INSERT                 ON public.audit_planning_log        TO authenticated;
GRANT ALL                            ON public.routes                    TO service_role;
GRANT ALL                            ON public.route_jobs                TO service_role;
GRANT ALL                            ON public.driver_daily_compliance   TO service_role;
GRANT ALL                            ON public.lane_travel_times         TO service_role;
GRANT ALL                            ON public.warehouse_dwell_profiles  TO service_role;
GRANT ALL                            ON public.warehouse_hours           TO service_role;
GRANT ALL                            ON public.audit_planning_log        TO service_role;
GRANT ALL                            ON public.planning_queue            TO service_role;
GRANT USAGE, SELECT                  ON SEQUENCE public.planning_queue_id_seq TO service_role;
