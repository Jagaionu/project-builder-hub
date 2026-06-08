-- MIGRATION #32: Support tickets (help / case system). Additive + idempotent.
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              text,
  tenant_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by       uuid,
  created_by_name  text,
  created_by_email text,
  category         text NOT NULL,
  severity         int  NOT NULL CHECK (severity BETWEEN 1 AND 5),
  title            text NOT NULL,
  description      text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','resolved')),
  attachments      text[] NOT NULL DEFAULT '{}',
  context          jsonb,
  assigned_to      uuid,
  admin_note       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created ON public.support_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_created ON public.support_tickets (tenant_id, created_at DESC);
CREATE OR REPLACE FUNCTION public.support_ticket_set_ref()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.ref IS NULL THEN NEW.ref := 'CASE-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 6)); END IF;
  NEW.updated_at := now();
  IF NEW.status = 'resolved' AND NEW.resolved_at IS NULL THEN NEW.resolved_at := now(); END IF;
  RETURN NEW;
END; $fn$;
DROP TRIGGER IF EXISTS trg_support_ticket_ref ON public.support_tickets;
CREATE TRIGGER trg_support_ticket_ref BEFORE INSERT OR UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.support_ticket_set_ref();
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_tickets_tenant_select ON public.support_tickets;
CREATE POLICY support_tickets_tenant_select ON public.support_tickets FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS support_tickets_tenant_insert ON public.support_tickets;
CREATE POLICY support_tickets_tenant_insert ON public.support_tickets FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS support_tickets_admin_update ON public.support_tickets;
CREATE POLICY support_tickets_admin_update ON public.support_tickets FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DO $rt$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets; EXCEPTION WHEN duplicate_object THEN NULL; END $rt$;
-- Private attachments bucket + tenant-scoped storage policies.
INSERT INTO storage.buckets (id, name, public) VALUES ('support-attachments', 'support-attachments', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS support_attach_insert ON storage.objects;
CREATE POLICY support_attach_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'support-attachments' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
DROP POLICY IF EXISTS support_attach_select ON storage.objects;
CREATE POLICY support_attach_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'support-attachments' AND ((storage.foldername(name))[1] = public.current_tenant_id()::text OR public.is_super_admin()));
