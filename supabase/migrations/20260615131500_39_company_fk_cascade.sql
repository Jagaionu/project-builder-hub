-- MIGRATION #39: ON DELETE CASCADE for every foreign key that references
-- companies(id), so deleting a company removes all its tenant-scoped rows
-- instead of failing (e.g. driver_availability_overrides_tenant_id_fkey).
-- Idempotent: only rewrites FKs that do not already declare an ON DELETE
-- action. Inherited partition constraints are skipped and handled via their
-- parent partitioned table (driver_events / driver_positions).
DO $cascade$
DECLARE
  r record;
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
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%ON DELETE%'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s ON DELETE CASCADE', r.schema_name, r.table_name, r.conname, r.def);
    RAISE NOTICE 'cascaded FK % on %.%', r.conname, r.schema_name, r.table_name;
  END LOOP;
END
$cascade$;
