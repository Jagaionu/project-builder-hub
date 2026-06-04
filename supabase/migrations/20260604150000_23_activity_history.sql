-- ============================================================
-- MIGRATION #23: Activity history + per-company profiles + avatars bucket
--
-- Additive + idempotent. Safe to run at any time. No destructive changes.
-- Prerequisites: multi_tenant_auth (companies, company_members, super_admins,
--   current_tenant_id(), is_super_admin()) and #22 route_notes applied.
--
-- Adds:
--   1. activity_log            — per-tenant user-action audit (14-day retention)
--   2. route_notes authorship  — author_user_id / author_name / author_email
--   3. company_members profile — name / email / must_set_password (+ SELECT RLS)
--   4. purge_activity_log()    — daily pg_cron, deletes rows > 14 days
--   5. avatars storage bucket  — optional profile pictures (public read, owner write)
-- ============================================================

-- ════════════════════════════════════════════════════════════════════
-- 1. activity_log  (NOT partitioned — 14-day window is tiny)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.activity_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email   text,
  actor_name    text,
  action        text NOT NULL,
  entity_type   text,
  entity_id     uuid,
  entity_ref    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_time
  ON public.activity_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_action
  ON public.activity_log (tenant_id, action);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity
  ON public.activity_log (entity_type, entity_id, created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activity_log_select ON public.activity_log;
DROP POLICY IF EXISTS activity_log_insert ON public.activity_log;

-- Tenant-scoped read; super admin sees all.
CREATE POLICY activity_log_select ON public.activity_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- Insert only within own tenant. No UPDATE/DELETE policies → append-only.
CREATE POLICY activity_log_insert ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL          ON public.activity_log TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 2. route_notes authorship (nullable; existing rows stay NULL)
--    Guarded: skips cleanly if route_notes (migration #22) isn't present.
-- ════════════════════════════════════════════════════════════════════
DO $rn$
BEGIN
  IF to_regclass('public.route_notes') IS NOT NULL THEN
    ALTER TABLE public.route_notes
      ADD COLUMN IF NOT EXISTS author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS author_name    text,
      ADD COLUMN IF NOT EXISTS author_email   text;
  ELSE
    RAISE NOTICE 'route_notes not found — skipping authorship columns (apply migration #22 first).';
  END IF;
END $rn$;

-- ════════════════════════════════════════════════════════════════════
-- 3. company_members: profile fields + same-tenant SELECT (for the switcher)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.company_members
  ADD COLUMN IF NOT EXISTS name              text,
  ADD COLUMN IF NOT EXISTS email             text,
  ADD COLUMN IF NOT EXISTS must_set_password boolean NOT NULL DEFAULT false;

-- SELECT-only widening: a member may read OTHER members of their OWN company
-- (needed to list profiles in the switcher). Existing policies remain; RLS
-- permissive policies OR together, so writes stay gated by super_admin_all.
DROP POLICY IF EXISTS company_members_select_same_tenant ON public.company_members;
CREATE POLICY company_members_select_same_tenant ON public.company_members
  FOR SELECT TO authenticated
  USING (company_id = public.current_tenant_id() OR public.is_super_admin());

-- ════════════════════════════════════════════════════════════════════
-- 4. Retention — purge activity_log > 14 days (matches VRID/import lifetime)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.purge_activity_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  DELETE FROM public.activity_log WHERE created_at < now() - interval '14 days';
$$;

REVOKE EXECUTE ON FUNCTION public.purge_activity_log() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_activity_log() TO service_role;

-- Idempotent schedule, wrapped so a missing pg_cron / permission never fails
-- the migration — the purge function still exists and can be scheduled manually.
DO $sched$
BEGIN
  PERFORM cron.unschedule('purge-activity-log');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $sched$;

DO $sched$
BEGIN
  PERFORM cron.schedule('purge-activity-log', '0 3 * * *', $$ SELECT public.purge_activity_log(); $$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable — schedule purge-activity-log() manually (daily).';
END $sched$;

-- ════════════════════════════════════════════════════════════════════
-- 5. avatars storage bucket (optional profile pictures)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS avatars_public_read  ON storage.objects;
DROP POLICY IF EXISTS avatars_owner_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_owner_update ON storage.objects;
DROP POLICY IF EXISTS avatars_owner_delete ON storage.objects;

CREATE POLICY avatars_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY avatars_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());

CREATE POLICY avatars_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid());

CREATE POLICY avatars_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid());
