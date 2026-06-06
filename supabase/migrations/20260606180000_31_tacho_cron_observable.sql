-- MIGRATION #31: make the tacho weekly cron observable (supersedes the silent
-- block in #30, which used EXCEPTION WHEN OTHERS THEN NULL and hid the real
-- failure, typically pg_cron not enabled). Attempts to enable pg_cron, then
-- re-schedules and RAISEs a NOTICE with the outcome. Idempotent.

DO $ext$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not CREATE EXTENSION pg_cron (enable it in Dashboard > Database > Extensions): %', SQLERRM;
END $ext$;

DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('tacho-weekly-requests','0 0 * * 1','SELECT public.tacho_create_weekly_requests();');
    RAISE NOTICE 'Cron scheduled: tacho-weekly-requests';
  ELSE
    RAISE NOTICE 'pg_cron not installed; skipped scheduling tacho-weekly-requests';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cron scheduling failed: %', SQLERRM;
END $cron$;
