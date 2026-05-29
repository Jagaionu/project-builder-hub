-- ============================================================
-- MIGRATION #13: Partition driver_events + audit_planning_log by month
--
-- ⚠️  REVIEW + SCHEDULE A LOW-TRAFFIC MAINTENANCE WINDOW (e.g. Sun 02:00).
-- Prerequisites: Migrations #1-#12 applied.
--
-- Same pattern + safety model as migration #8 (driver_positions):
--   • Each table swap is its OWN guarded transaction. If it's already
--     partitioned the guard RAISEs and aborts THAT transaction before any
--     destructive step (so re-running is safe and non-destructive).
--   • The swap is transactional: concurrent writers block on the lock and
--     transparently hit the new partitioned table after COMMIT — no data loss.
--   • PK gains the partition column: (id, timestamp) / (id, created_at).
--   • Pre-creates monthly partitions 2026-01..2027-12 + a DEFAULT catch-all.
--     Use the pg_cron snippet at the bottom for ongoing monthly partitions.
--
-- IMPORTANT difference vs #8: driver_events is in the supabase_realtime
-- publication (the Events page / alerts subscribe to it). The swap re-adds it.
-- audit_planning_log is INSERT-only/immutable — no UPDATE/DELETE policies.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════
-- PART A — driver_events  (RANGE on timestamp)
-- ════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'driver_events' AND c.relnamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'driver_events already partitioned — do NOT re-run PART A.';
  END IF;
END $$;

ALTER TABLE public.driver_events RENAME TO driver_events_old;

CREATE TABLE public.driver_events (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  driver_id   uuid        NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  type        public.driver_event_type NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  timestamp   timestamptz NOT NULL DEFAULT now(),
  tenant_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

DO $$
DECLARE
  d date := date '2026-01-01';
  part text;
BEGIN
  WHILE d < date '2028-01-01' LOOP
    part := 'driver_events_' || to_char(d, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.driver_events '
      'FOR VALUES FROM (%L) TO (%L)',
      part, d::timestamptz, (d + interval '1 month')::timestamptz);
    d := (d + interval '1 month')::date;
  END LOOP;
  EXECUTE 'CREATE TABLE IF NOT EXISTS public.driver_events_default '
          'PARTITION OF public.driver_events DEFAULT';
END $$;

INSERT INTO public.driver_events (id, driver_id, type, payload, timestamp, tenant_id)
SELECT id, driver_id, type, payload, timestamp, tenant_id FROM public.driver_events_old;

-- Indexes (recreate the ones from base + #1).
CREATE INDEX IF NOT EXISTS idx_driver_events_driver
  ON public.driver_events (driver_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_driver_events_tenant
  ON public.driver_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_events_tenant_driver_time
  ON public.driver_events (tenant_id, driver_id, timestamp);

-- RLS (from migration #2).
ALTER TABLE public.driver_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_events_select ON public.driver_events;
DROP POLICY IF EXISTS driver_events_mutate ON public.driver_events;

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

-- Tenant-sync trigger (from #1).
DROP TRIGGER IF EXISTS trg_driver_events_tenant ON public.driver_events;
CREATE TRIGGER trg_driver_events_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON public.driver_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_from_driver();

-- Grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_events TO authenticated;
GRANT ALL ON public.driver_events TO service_role;

-- Re-add to realtime (the renamed _old dropped out of the publication).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'driver_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_events;
  END IF;
END $$;

DROP TABLE public.driver_events_old;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- PART B — audit_planning_log  (RANGE on created_at, INSERT-only)
-- ════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'audit_planning_log' AND c.relnamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'audit_planning_log already partitioned — do NOT re-run PART B.';
  END IF;
END $$;

ALTER TABLE public.audit_planning_log RENAME TO audit_planning_log_old;

CREATE TABLE public.audit_planning_log (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type       text NOT NULL CHECK (entity_type IN ('job','route','route_job','driver_assignment','plan_run')),
  entity_id         uuid NOT NULL,
  action            text NOT NULL,
  old_value         jsonb,
  new_value         jsonb,
  planner_user_id   uuid REFERENCES auth.users(id),
  driver_id         uuid REFERENCES public.drivers(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
  d date := date '2026-01-01';
  part text;
BEGIN
  WHILE d < date '2028-01-01' LOOP
    part := 'audit_planning_log_' || to_char(d, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.audit_planning_log '
      'FOR VALUES FROM (%L) TO (%L)',
      part, d::timestamptz, (d + interval '1 month')::timestamptz);
    d := (d + interval '1 month')::date;
  END LOOP;
  EXECUTE 'CREATE TABLE IF NOT EXISTS public.audit_planning_log_default '
          'PARTITION OF public.audit_planning_log DEFAULT';
END $$;

INSERT INTO public.audit_planning_log
  (id, tenant_id, entity_type, entity_id, action, old_value, new_value, planner_user_id, driver_id, created_at)
SELECT
  id, tenant_id, entity_type, entity_id, action, old_value, new_value, planner_user_id, driver_id, created_at
FROM public.audit_planning_log_old;

CREATE INDEX IF NOT EXISTS idx_audit_planning_log_entity
  ON public.audit_planning_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_planning_log_tenant_time
  ON public.audit_planning_log (tenant_id, created_at DESC);

-- RLS (from #4): SELECT scoped + INSERT-only. No UPDATE/DELETE → immutable.
ALTER TABLE public.audit_planning_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_planning_log_select ON public.audit_planning_log;
DROP POLICY IF EXISTS audit_planning_log_insert ON public.audit_planning_log;

CREATE POLICY audit_planning_log_select ON public.audit_planning_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

CREATE POLICY audit_planning_log_insert ON public.audit_planning_log
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

GRANT SELECT, INSERT ON public.audit_planning_log TO authenticated;
GRANT ALL          ON public.audit_planning_log TO service_role;

DROP TABLE public.audit_planning_log_old;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- ONGOING MAINTENANCE (pg_cron) — extend the migration #8 maintainer or add:
--
--   SELECT cron.schedule('events-audit-partitions', '0 2 1 * *', $$
--     DO $m$
--     DECLARE nxt date := (date_trunc('month', now()) + interval '1 month')::date;
--     BEGIN
--       EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.driver_events FOR VALUES FROM (%L) TO (%L)',
--         'driver_events_'||to_char(nxt,'YYYY_MM'), nxt::timestamptz, (nxt+interval '1 month')::timestamptz);
--       EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.audit_planning_log FOR VALUES FROM (%L) TO (%L)',
--         'audit_planning_log_'||to_char(nxt,'YYYY_MM'), nxt::timestamptz, (nxt+interval '1 month')::timestamptz);
--     END $m$;
--   $$);
--
-- NOTE: driver_events / audit_planning_log are COMPLIANCE/LEGAL records —
-- DO NOT drop old partitions (unlike driver_positions). Archive to cold
-- storage instead if needed.
-- ════════════════════════════════════════════════════════════════════
