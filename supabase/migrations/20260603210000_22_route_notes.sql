-- ============================================================
-- MIGRATION #22: route_notes table
--
-- Per-job notes attached to a route/job. Backed by public.route_notes.
-- Rows cascade-delete when the parent job is deleted via the FK.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.route_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- RLS: authenticated users of the same tenant can read/insert/delete.
ALTER TABLE public.route_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY route_notes_select ON public.route_notes
  FOR SELECT
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

CREATE POLICY route_notes_insert ON public.route_notes
  FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

CREATE POLICY route_notes_delete ON public.route_notes
  FOR DELETE
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- Index on job_id for fast lookups.
CREATE INDEX IF NOT EXISTS idx_route_notes_job_id ON public.route_notes (job_id);

COMMIT;
