-- MIGRATION #42: give every FK referencing drivers(id) / warehouses(id) a
-- sane ON DELETE action so deleting a company (which cascade-deletes its
-- drivers and warehouses) is never blocked by a RESTRICT/NO ACTION child FK
-- such as driver_day_hours_tachograph_entered_by_fkey.
--
-- Per FK: if every referencing column is nullable -> SET NULL (keep the row,
-- clear the link, e.g. jobs.assigned_driver_id, tachograph_entered_by);
-- otherwise -> CASCADE (the row is owned by the driver/warehouse).
-- Skips FKs that already declare CASCADE or SET NULL. Idempotent.
DO $fk$
DECLARE
  r record;
  newdef text;
  act text;
BEGIN
  FOR r IN
    SELECT con.conname, ns.nspname AS schema_name, rel.relname AS table_name,
           con.conkey, con.conrelid,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel    ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.contype = 'f'
      AND con.confrelid IN ('public.drivers'::regclass, 'public.warehouses'::regclass)
      AND con.coninhcount = 0
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%ON DELETE CASCADE%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%ON DELETE SET NULL%'
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = r.conrelid AND a.attnum = ANY(r.conkey) AND a.attnotnull
    ) THEN
      act := 'CASCADE';
    ELSE
      act := 'SET NULL';
    END IF;
    newdef := regexp_replace(r.def, '\s+ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)', '', 'gi');
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s ON DELETE %s', r.schema_name, r.table_name, r.conname, newdef, act);
    RAISE NOTICE 'set FK % on %.% to ON DELETE % (was: %)', r.conname, r.schema_name, r.table_name, act, r.def;
  END LOOP;
END
$fk$;
