-- ============================================================
-- MIGRATION: import_batches
--
-- Every CSV upload creates one import_batch row. Jobs created
-- by the upload carry import_batch_id. Deleting a batch
-- cascades to all its jobs (and job_stops via existing cascade).
--
-- csv_rows JSONB stores the parsed ImportRow[] — typically a few
-- KB, compressed automatically by Postgres TOAST. This lets the
-- user re-inspect what was uploaded without storing a raw file.
--
-- expires_at = created_at + 14 days.  A pg_cron job deletes
-- expired batches daily (cascade removes their jobs too).
-- ============================================================

-- ── 1. import_batches table ────────────────────────────────────────────────

CREATE TABLE public.import_batches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name       text        NOT NULL,
  row_count       integer     NOT NULL DEFAULT 0,
  created_count   integer     NOT NULL DEFAULT 0,
  parked_count    integer     NOT NULL DEFAULT 0,
  duplicate_count integer     NOT NULL DEFAULT 0,
  error_count     integer     NOT NULL DEFAULT 0,
  -- Parsed ImportRow[] stored as JSONB (Postgres TOAST auto-compresses).
  -- Keeps an auditable copy of what was uploaded without a raw file blob.
  csv_rows        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '14 days'
);

CREATE INDEX import_batches_tenant_idx ON public.import_batches (tenant_id, created_at DESC);
CREATE INDEX import_batches_expires_idx ON public.import_batches (expires_at);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_batches_select ON public.import_batches
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

CREATE POLICY import_batches_insert ON public.import_batches
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

CREATE POLICY import_batches_delete ON public.import_batches
  FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- Realtime so the Events page updates as soon as an import finishes
ALTER PUBLICATION supabase_realtime ADD TABLE public.import_batches;

-- ── 2. Link jobs → import_batch (CASCADE DELETE) ──────────────────────────
--
-- When a batch is deleted every job created from it is deleted too,
-- and job_stops follow via the existing ON DELETE CASCADE on job_stops.job_id.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS import_batch_id uuid
    REFERENCES public.import_batches(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_jobs_import_batch ON public.jobs (import_batch_id);

-- ── 3. Link pending_job_imports → import_batch ────────────────────────────
--
-- Parked rows are also part of the batch; deleting the batch removes them.

ALTER TABLE public.pending_job_imports
  ADD COLUMN IF NOT EXISTS import_batch_id uuid
    REFERENCES public.import_batches(id) ON DELETE CASCADE;

-- ── 4. pg_cron: delete expired batches daily at 03:00 UTC ─────────────────
--
-- Cascade takes care of jobs, job_stops, pending_job_imports automatically.

SELECT cron.schedule(
  'cleanup-expired-import-batches',
  '0 3 * * *',
  $$DELETE FROM public.import_batches WHERE expires_at < now();$$
);
