-- MIGRATION #41: make sync_tenant_from_driver() null-safe.
--
-- Deleting a company cascades to drivers; a driver delete fires
-- driver_day_hours.driver_id ON DELETE SET NULL, whose UPDATE trips the
-- trg_driver_day_hours_tenant trigger. The trigger recomputed tenant_id from
-- the now-NULL driver, nulling a NOT NULL column and aborting the delete.
-- Now: when driver_id is NULL, leave the existing tenant_id untouched.
-- Idempotent (CREATE OR REPLACE keeps existing triggers attached).
CREATE OR REPLACE FUNCTION public.sync_tenant_from_driver()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.driver_id IS NOT NULL THEN
    SELECT d.tenant_id INTO NEW.tenant_id FROM public.drivers d WHERE d.id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$fn$;
