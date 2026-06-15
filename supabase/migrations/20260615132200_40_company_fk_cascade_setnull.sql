-- MIGRATION #40: force ON DELETE CASCADE on ALL foreign keys referencing
-- companies(id), including those currently ON DELETE SET NULL / RESTRICT.
-- #39 only handled FKs with no ON DELETE clause; some (e.g.
-- driver_day_hours_tenant_id_fkey) were ON DELETE SET NULL, which violates the
-- NOT NULL tenant_id when a company is deleted. Strips any existing ON DELETE
-- action, then re-adds ON DELETE CASCADE. Idempotent (skips already-cascading).
DO $cascade$
DECLARE
  r record;
  newdef text;
BEGIN
  FOR r IN
    SELECT con.conname,
           ns.nspname  AS schema_name,
           rel.relname AS table_name,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel    ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.companies'::regclass
      AND con.coninhcount = 0
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%ON DELETE CASCADE%'
  LOOP
    newdef := regexp_replace(r.def, '\s+ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)', '', 'gi');
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s ON DELETE CASCADE', r.schema_name, r.table_name, r.conname, newdef);
    RAISE NOTICE 'cascaded FK % on %.% (was: %)', r.conname, r.schema_name, r.table_name, r.def;
  END LOOP;
END
$cascade$;
