-- MIGRATION #34: 30-day retention for support tickets. Daily purge of tickets
-- created more than 30 days ago; their messages cascade and their attachment
-- objects are removed from storage. Additive/idempotent. Observable cron.
CREATE OR REPLACE FUNCTION public.purge_old_support_tickets()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_count integer := 0;
BEGIN
  DELETE FROM storage.objects
  WHERE bucket_id = 'support-attachments'
    AND name IN (SELECT unnest(attachments) FROM public.support_tickets
                 WHERE created_at < now() - interval '30 days');
  DELETE FROM public.support_tickets WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $fn$;
REVOKE EXECUTE ON FUNCTION public.purge_old_support_tickets() FROM PUBLIC, anon, authenticated;

DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('support-tickets-retention','0 3 * * *','SELECT public.purge_old_support_tickets();');
    RAISE NOTICE 'Cron scheduled: support-tickets-retention (daily 03:00 UTC)';
  ELSE
    RAISE NOTICE 'pg_cron not installed; skipped scheduling support-tickets-retention';
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Cron scheduling failed: %', SQLERRM;
END $cron$;
