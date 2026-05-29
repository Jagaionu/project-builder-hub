-- ============================================================
-- MIGRATION #2: Constraints, Indexes, RLS
--
-- DO NOT RUN UNTIL REVIEWED.
-- Prerequisites: Migration #1 applied; verify the RAISE NOTICEs from
--   Migration #1 reported no remaining NULL tenant_id rows before running.
--
-- Actions:
--   1. Replace wide-open ("public all") RLS policies with tenant-aware
--      ones on every newly-tenant'd table.
--   2. Consolidate the join-based RLS on driving_legs / stop_dwells (introduced
--      before tenant_id existed on those tables) with direct tenant_id checks.
--
-- NOTE: NOT NULL enforcement on tenant_id (incl. driver_events) is deferred
-- to Migration #6 so all irreversible lock-in steps live in one guarded place.
--
-- Policy template (mirrors import_batches / reimport_alerts pattern):
--   USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
--   plus an OR driver_id = public.current_driver_id() branch on tables a
--   driver-app user must access for their own data.
--
-- Service-role connections (server functions) bypass RLS automatically —
-- nothing in the planJobs / import / driver server fns needs to change.
--
-- tenant_id remains NULLABLE on the seven tables touched by Migration #1.
-- A future cleanup migration flips NOT NULL once we've confirmed inserts
-- (now guarded by sync_tenant_from_* triggers) cannot leak NULLs.
-- ============================================================

-- ── driver_shifts ─────────────────────────────────────────────────────────

ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver views own shift"   ON public.driver_shifts;
DROP POLICY IF EXISTS "driver manages own shift" ON public.driver_shifts;
DROP POLICY IF EXISTS driver_shifts_select       ON public.driver_shifts;
DROP POLICY IF EXISTS driver_shifts_mutate       ON public.driver_shifts;

CREATE POLICY driver_shifts_select ON public.driver_shifts
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY driver_shifts_mutate ON public.driver_shifts
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

-- ── driver_availability_overrides ─────────────────────────────────────────

ALTER TABLE public.driver_availability_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view overrides"                          ON public.driver_availability_overrides;
DROP POLICY IF EXISTS "manage overrides"                        ON public.driver_availability_overrides;
DROP POLICY IF EXISTS driver_availability_overrides_select      ON public.driver_availability_overrides;
DROP POLICY IF EXISTS driver_availability_overrides_mutate      ON public.driver_availability_overrides;

CREATE POLICY driver_availability_overrides_select ON public.driver_availability_overrides
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY driver_availability_overrides_mutate ON public.driver_availability_overrides
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

-- ── driver_day_hours ──────────────────────────────────────────────────────

ALTER TABLE public.driver_day_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public all"             ON public.driver_day_hours;
DROP POLICY IF EXISTS driver_day_hours_select  ON public.driver_day_hours;
DROP POLICY IF EXISTS driver_day_hours_mutate  ON public.driver_day_hours;

CREATE POLICY driver_day_hours_select ON public.driver_day_hours
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

-- Driver compliance ledger is computed server-side; only super admin / tenant
-- admins should mutate it via direct SQL. Drivers cannot edit their own hours.
CREATE POLICY driver_day_hours_mutate ON public.driver_day_hours
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- ── driver_positions ──────────────────────────────────────────────────────

ALTER TABLE public.driver_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public all"                ON public.driver_positions;
DROP POLICY IF EXISTS driver_positions_select     ON public.driver_positions;
DROP POLICY IF EXISTS driver_positions_mutate     ON public.driver_positions;

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

-- ── driving_legs ──────────────────────────────────────────────────────────
-- Replace the legacy join-based policies (from migration 20260523070356)
-- with direct tenant_id checks now that the column exists and is backfilled.

ALTER TABLE public.driving_legs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driving_legs_tenant_select  ON public.driving_legs;
DROP POLICY IF EXISTS driving_legs_tenant_insert  ON public.driving_legs;
DROP POLICY IF EXISTS driving_legs_tenant_update  ON public.driving_legs;
DROP POLICY IF EXISTS driving_legs_select         ON public.driving_legs;
DROP POLICY IF EXISTS driving_legs_mutate         ON public.driving_legs;

CREATE POLICY driving_legs_select ON public.driving_legs
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY driving_legs_mutate ON public.driving_legs
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

-- ── stop_dwells ───────────────────────────────────────────────────────────

ALTER TABLE public.stop_dwells ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stop_dwells_tenant_select   ON public.stop_dwells;
DROP POLICY IF EXISTS stop_dwells_tenant_insert   ON public.stop_dwells;
DROP POLICY IF EXISTS stop_dwells_tenant_update   ON public.stop_dwells;
DROP POLICY IF EXISTS stop_dwells_select          ON public.stop_dwells;
DROP POLICY IF EXISTS stop_dwells_mutate          ON public.stop_dwells;

CREATE POLICY stop_dwells_select ON public.stop_dwells
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY stop_dwells_mutate ON public.stop_dwells
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

-- ── driver_events ─────────────────────────────────────────────────────────

ALTER TABLE public.driver_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public all"          ON public.driver_events;
DROP POLICY IF EXISTS driver_events_select  ON public.driver_events;
DROP POLICY IF EXISTS driver_events_mutate  ON public.driver_events;

CREATE POLICY driver_events_select ON public.driver_events
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR driver_id = public.current_driver_id()
  );

CREATE POLICY driver_events_mutate ON public.driver_events
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

-- ── job_stops ─────────────────────────────────────────────────────────────
-- Replace the wide-open "public all" policy from migration 20260520145731
-- with a tenant-aware policy. The OR-join to jobs covers any row that
-- has not yet had tenant_id backfilled (defence in depth).

ALTER TABLE public.job_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public all"      ON public.job_stops;
DROP POLICY IF EXISTS job_stops_select  ON public.job_stops;
DROP POLICY IF EXISTS job_stops_mutate  ON public.job_stops;

CREATE POLICY job_stops_select ON public.job_stops
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_stops.job_id
        AND (j.tenant_id = public.current_tenant_id() OR public.is_super_admin())
    )
  );

CREATE POLICY job_stops_mutate ON public.job_stops
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_stops.job_id
        AND j.tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_stops.job_id
        AND j.tenant_id = public.current_tenant_id()
    )
  );

-- ── NOT NULL enforcement is deferred to Migration #6 ──────────────────────
-- All tenant_id NOT NULL flips (including driver_events) are consolidated
-- into Migration #6 so the irreversible "lock-in" step is isolated and
-- applied only after the additive backfill (#1) and RLS (#2) have soaked
-- in production. This keeps every NOT NULL flip in one guarded place rather
-- than scattering them across migrations.
