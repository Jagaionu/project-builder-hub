-- ============================================================
-- MIGRATION: reimport_alerts
--
-- When an uploaded plan contains a VRID/job reference that already
-- exists in the jobs table, instead of silently skipping it, the
-- import function will insert a row here so it surfaces in Alerts.
--
-- Columns:
--   reference   — the duplicate VRID (e.g. "116SPMQY1")
--   lane        — the route from the new upload (e.g. "EMA2->MAN8")
--   uploaded_at — when the re-upload was detected (auto-set)
-- ============================================================

CREATE TABLE public.reimport_alerts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference    text        NOT NULL,
  lane         text        NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  -- Prevent stacking duplicate alerts for the same reference
  UNIQUE (tenant_id, reference)
);

CREATE INDEX reimport_alerts_tenant_idx ON public.reimport_alerts (tenant_id, uploaded_at DESC);

ALTER TABLE public.reimport_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY reimport_alerts_select ON public.reimport_alerts
  FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

CREATE POLICY reimport_alerts_insert ON public.reimport_alerts
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- Server functions use supabaseAdmin (bypasses RLS), so UPDATE/DELETE are
-- also needed for ack (dismiss).
CREATE POLICY reimport_alerts_delete ON public.reimport_alerts
  FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- Realtime so the Alerts page updates instantly when a re-upload is detected
ALTER PUBLICATION supabase_realtime ADD TABLE public.reimport_alerts;
