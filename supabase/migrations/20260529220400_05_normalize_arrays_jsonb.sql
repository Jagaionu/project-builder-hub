-- ============================================================
-- MIGRATION #5: Normalize array / JSONB columns into child tables
--
-- DO NOT RUN UNTIL REVIEWED.
-- Prerequisites: Migrations #1-#4 applied.
--
-- Two long-standing anti-patterns are corrected, additively:
--
--   1. pending_job_imports.stop_scheduled_at  (timestamptz[])
--      → pending_import_stops (one row per stop)
--      Indexable, query-able, and matches how job_stops is modelled.
--
--   2. import_batches.csv_rows  (jsonb)
--      → import_rows (one row per CSV line)
--      Avoids giant JSONB documents that bloat backups and break the
--      4 GB row TOAST limit on large uploads.
--
-- Both old columns are KEPT for now (not dropped). Existing code paths
-- continue to work unchanged. A follow-up commit will migrate the import
-- pipeline + promotion trigger to read from the new child tables, after
-- which a final cleanup migration can drop the legacy columns.
--
-- This migration is fully additive and idempotent (CREATE IF NOT EXISTS,
-- INSERT ... ON CONFLICT). Re-running is safe.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════
-- 1.  pending_import_stops
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pending_import_stops (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_import_id   uuid NOT NULL REFERENCES public.pending_job_imports(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  stop_index          smallint NOT NULL CHECK (stop_index >= 0),
  scheduled_at        timestamptz,
  warehouse_code      text,
  kind                text CHECK (kind IN ('PICKUP', 'DROP')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pending_import_id, stop_index)
);

CREATE INDEX IF NOT EXISTS idx_pending_import_stops_parent
  ON public.pending_import_stops (pending_import_id, stop_index);
CREATE INDEX IF NOT EXISTS idx_pending_import_stops_tenant_scheduled
  ON public.pending_import_stops (tenant_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_import_stops_warehouse_code
  ON public.pending_import_stops (tenant_id, upper(warehouse_code))
  WHERE warehouse_code IS NOT NULL;

-- Migrate existing data: explode each pending_job_imports row's
-- stop_scheduled_at[] (and the lane "A->B->C") into one stop per index.
--
-- IMPORTANT — `kind` is NOT inferred from position. The original lane string
-- only stores warehouse codes in sequence; it does NOT record whether an
-- intermediate stop is a PICKUP or a DROP. A multi-stop lane can legitimately
-- have intermediate drops (e.g. A pickup → B drop → C drop). Guessing
-- "first = PICKUP, everything else = DROP" (or vice-versa) would silently
-- corrupt those imports.
--
-- Therefore migrated rows get kind = NULL. The promotion trigger / import
-- pipeline already derives the real PICKUP/DROP sequence when it builds
-- job_stops, so leaving kind NULL here is lossless. New imports written
-- directly to pending_import_stops can populate kind authoritatively.
INSERT INTO public.pending_import_stops
  (pending_import_id, tenant_id, stop_index, scheduled_at, warehouse_code, kind)
SELECT
  pji.id                                        AS pending_import_id,
  pji.tenant_id                                 AS tenant_id,
  (idx - 1)::smallint                           AS stop_index,
  CASE
    WHEN idx <= COALESCE(array_length(pji.stop_scheduled_at, 1), 0)
      THEN pji.stop_scheduled_at[idx]
    ELSE NULL
  END                                           AS scheduled_at,
  trim((string_to_array(pji.lane, '->'))[idx])  AS warehouse_code,
  NULL                                          AS kind  -- not inferable from lane; see note above
FROM public.pending_job_imports pji
CROSS JOIN LATERAL generate_series(1, array_length(string_to_array(pji.lane, '->'), 1)) AS idx
ON CONFLICT (pending_import_id, stop_index) DO NOTHING;

-- RLS
ALTER TABLE public.pending_import_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_import_stops_select ON public.pending_import_stops;
DROP POLICY IF EXISTS pending_import_stops_mutate ON public.pending_import_stops;

CREATE POLICY pending_import_stops_select ON public.pending_import_stops
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

CREATE POLICY pending_import_stops_mutate ON public.pending_import_stops
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_import_stops TO authenticated;
GRANT ALL                            ON public.pending_import_stops TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 2.  import_rows  (normalized csv_rows JSONB)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.import_rows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  row_index    integer NOT NULL CHECK (row_index >= 0),
  data         jsonb NOT NULL,
  outcome      text CHECK (outcome IN ('created', 'parked', 'duplicate', 'error')),
  outcome_note text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_import_rows_batch
  ON public.import_rows (batch_id, row_index);
CREATE INDEX IF NOT EXISTS idx_import_rows_tenant_outcome
  ON public.import_rows (tenant_id, outcome, created_at DESC);

-- Migrate existing csv_rows JSONB documents into one row per element.
INSERT INTO public.import_rows
  (batch_id, tenant_id, row_index, data)
SELECT
  ib.id            AS batch_id,
  ib.tenant_id     AS tenant_id,
  (idx - 1)::int   AS row_index,
  elem             AS data
FROM public.import_batches ib
CROSS JOIN LATERAL jsonb_array_elements(ib.csv_rows) WITH ORDINALITY AS t(elem, idx)
WHERE jsonb_typeof(ib.csv_rows) = 'array'
  AND jsonb_array_length(ib.csv_rows) > 0
ON CONFLICT (batch_id, row_index) DO NOTHING;

-- RLS
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_rows_select ON public.import_rows;
DROP POLICY IF EXISTS import_rows_mutate ON public.import_rows;

CREATE POLICY import_rows_select ON public.import_rows
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

CREATE POLICY import_rows_mutate ON public.import_rows
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_rows TO authenticated;
GRANT ALL                            ON public.import_rows TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 3.  Documentation: mark legacy columns deprecated
-- ════════════════════════════════════════════════════════════════════

COMMENT ON COLUMN public.pending_job_imports.stop_scheduled_at IS
  'DEPRECATED. Replaced by pending_import_stops. Kept temporarily for backwards '
  'compatibility with the parked-import promotion trigger. Will be dropped once '
  'the trigger is migrated to read from pending_import_stops.';

COMMENT ON COLUMN public.import_batches.csv_rows IS
  'DEPRECATED. Replaced by import_rows. Kept temporarily for backwards '
  'compatibility with the Events page UI that displays per-batch rows. '
  'Will be cleared / dropped once UI reads from import_rows.';
