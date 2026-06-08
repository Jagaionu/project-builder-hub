-- MIGRATION #33: two-way support conversation + reporter re-open. Additive/idempotent.
CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id   uuid,
  author_name text,
  is_admin    boolean NOT NULL DEFAULT false,
  is_system   boolean NOT NULL DEFAULT false,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_msg_ticket_created ON public.support_ticket_messages (ticket_id, created_at);
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_msg_select ON public.support_ticket_messages;
CREATE POLICY support_msg_select ON public.support_ticket_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND (t.tenant_id = public.current_tenant_id() OR public.is_super_admin())));
DROP POLICY IF EXISTS support_msg_insert ON public.support_ticket_messages;
CREATE POLICY support_msg_insert ON public.support_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND (t.tenant_id = public.current_tenant_id() OR public.is_super_admin())));
DO $rt$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_messages; EXCEPTION WHEN duplicate_object THEN NULL; END $rt$;
CREATE OR REPLACE FUNCTION public.reopen_support_ticket(p_ticket_id uuid)
RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_t public.support_tickets;
BEGIN
  SELECT * INTO v_t FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF NOT (v_t.tenant_id = public.current_tenant_id() OR public.is_super_admin()) THEN RAISE EXCEPTION 'not your ticket' USING errcode = '42501'; END IF;
  UPDATE public.support_tickets SET status = 'pending', resolved_at = NULL WHERE id = p_ticket_id RETURNING * INTO v_t;
  RETURN v_t;
END; $fn$;
REVOKE EXECUTE ON FUNCTION public.reopen_support_ticket(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reopen_support_ticket(uuid) TO authenticated;
