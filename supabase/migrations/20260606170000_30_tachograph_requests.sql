-- MIGRATION #30: Tachograph weekly hours — forced submission model.
-- One request per completed Mon-Sun week; driver fills via a modal; submitted
-- total auto-applies to compliance rings (no approval); large gap vs GPS
-- estimate is flagged for dispatcher review. tenant_id = company. Idempotent.

CREATE TABLE IF NOT EXISTS public.tachograph_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','archived')),
  drive_minutes    integer,
  estimate_minutes integer,
  break_mins       integer,
  notes            text,
  discrepancy   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  CONSTRAINT uq_tacho_request UNIQUE (driver_id, period_start, period_end, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_tacho_req_tenant_status_created ON public.tachograph_requests (tenant_id, status, created_at DESC);
ALTER TABLE public.tachograph_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tacho_req_access ON public.tachograph_requests;
CREATE POLICY tacho_req_access ON public.tachograph_requests FOR ALL TO authenticated
  USING (driver_id = public.current_driver_id() OR tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (driver_id = public.current_driver_id() OR tenant_id = public.current_tenant_id() OR public.is_super_admin());
DO $rt$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tachograph_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $rt$;

CREATE OR REPLACE FUNCTION public.tacho_create_weekly_requests()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_count integer := 0;
  v_this_mon date := (now() AT TIME ZONE 'UTC')::date - ((EXTRACT(ISODOW FROM (now() AT TIME ZONE 'UTC'))::int) - 1);
BEGIN
  WITH wk(ps) AS (VALUES (v_this_mon - 7), (v_this_mon - 14))
  INSERT INTO public.tachograph_requests (driver_id, tenant_id, period_start, period_end, status)
  SELECT d.id, d.tenant_id, wk.ps, wk.ps + 6, 'pending'
  FROM public.drivers d CROSS JOIN wk WHERE d.tenant_id IS NOT NULL
  ON CONFLICT (driver_id, period_start, period_end, tenant_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT; RETURN v_count;
END; $fn$;
REVOKE EXECUTE ON FUNCTION public.tacho_create_weekly_requests() FROM PUBLIC, anon, authenticated;
DO $cron$ BEGIN
  PERFORM cron.schedule('tacho-weekly-requests','0 0 * * 1','SELECT public.tacho_create_weekly_requests();');
EXCEPTION WHEN OTHERS THEN NULL; END $cron$;

CREATE OR REPLACE FUNCTION public.log_tachograph_hours(
  p_request_id uuid, p_drive_minutes integer, p_break_mins integer DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS public.tachograph_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_req public.tachograph_requests; v_driver uuid := public.current_driver_id(); v_estimate integer;
BEGIN
  SELECT * INTO v_req FROM public.tachograph_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tacho request not found'; END IF;
  IF v_req.driver_id <> v_driver THEN RAISE EXCEPTION 'not your tachograph request' USING errcode='42501'; END IF;
  IF p_drive_minutes IS NULL OR p_drive_minutes < 0 THEN RAISE EXCEPTION 'drive_minutes must be >= 0'; END IF;
  SELECT COALESCE(SUM(drive_minutes),0)::int INTO v_estimate FROM public.driver_day_hours
    WHERE driver_id = v_req.driver_id AND day >= v_req.period_start AND day <= v_req.period_end;
  UPDATE public.tachograph_requests
  SET status='submitted', drive_minutes=p_drive_minutes, estimate_minutes=v_estimate,
      break_mins=p_break_mins, notes=p_notes,
      discrepancy=(v_estimate > 0 AND abs(p_drive_minutes - v_estimate) > GREATEST(120,(0.4*v_estimate)::int)),
      submitted_at=now()
  WHERE id = p_request_id RETURNING * INTO v_req;
  RETURN v_req;
END; $fn$;
REVOKE EXECUTE ON FUNCTION public.log_tachograph_hours(uuid,integer,integer,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_tachograph_hours(uuid,integer,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resend_tachograph_request(p_request_id uuid)
RETURNS public.tachograph_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_req public.tachograph_requests;
BEGIN
  SELECT * INTO v_req FROM public.tachograph_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tacho request not found'; END IF;
  IF NOT (v_req.tenant_id = public.current_tenant_id() OR public.is_super_admin()) THEN RAISE EXCEPTION 'not your company' USING errcode='42501'; END IF;
  UPDATE public.tachograph_requests SET status='pending', submitted_at=NULL, discrepancy=false
  WHERE id = p_request_id RETURNING * INTO v_req;
  RETURN v_req;
END; $fn$;
REVOKE EXECUTE ON FUNCTION public.resend_tachograph_request(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resend_tachograph_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tachograph_requests(p_status text DEFAULT NULL)
RETURNS SETOF public.tachograph_requests LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  SELECT * FROM public.tachograph_requests
  WHERE tenant_id = public.current_tenant_id() AND (p_status IS NULL OR status = p_status)
  ORDER BY created_at DESC;
$fn$;
REVOKE EXECUTE ON FUNCTION public.get_tachograph_requests(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_tachograph_requests(text) TO authenticated;
