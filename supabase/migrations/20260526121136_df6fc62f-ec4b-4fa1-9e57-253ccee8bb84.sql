
-- 1. Parked imports table
CREATE TABLE public.pending_job_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  reference text NOT NULL,
  lane text NOT NULL,
  equipment_type text,
  stop_scheduled_at timestamptz[] NOT NULL DEFAULT '{}',
  missing_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference)
);

CREATE INDEX pending_job_imports_tenant_idx ON public.pending_job_imports (tenant_id);
CREATE INDEX pending_job_imports_missing_codes_idx ON public.pending_job_imports USING GIN (missing_codes);

ALTER TABLE public.pending_job_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY pji_tenant_select ON public.pending_job_imports
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_super_admin());

CREATE POLICY pji_tenant_insert ON public.pending_job_imports
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

CREATE POLICY pji_tenant_update ON public.pending_job_imports
  FOR UPDATE USING (tenant_id = current_tenant_id() OR is_super_admin());

CREATE POLICY pji_tenant_delete ON public.pending_job_imports
  FOR DELETE USING (tenant_id = current_tenant_id() OR is_super_admin());

CREATE TRIGGER pji_touch_updated_at
  BEFORE UPDATE ON public.pending_job_imports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Promotion function: re-resolve parked rows for a tenant after a new
-- warehouse code is created. If all codes resolve, insert a job + stops and
-- delete the parked row; otherwise shrink missing_codes.
CREATE OR REPLACE FUNCTION public.promote_pending_imports_for_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parked record;
  code text;
  codes text[];
  wh_id uuid;
  missing text[];
  resolved_ids uuid[];
  new_job_id uuid;
  first_scheduled timestamptz;
  i int;
BEGIN
  -- Only react when this new warehouse could unblock a parked row.
  FOR parked IN
    SELECT *
    FROM public.pending_job_imports
    WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
      AND upper(NEW.code) = ANY (SELECT upper(c) FROM unnest(missing_codes) AS c)
  LOOP
    -- Re-resolve every code in the lane against current warehouses (tenant-scoped).
    codes := string_to_array(parked.lane, '->');
    missing := '{}';
    resolved_ids := '{}';
    FOREACH code IN ARRAY codes LOOP
      code := trim(code);
      IF code = '' THEN CONTINUE; END IF;
      SELECT w.id INTO wh_id
      FROM public.warehouses w
      WHERE upper(w.code) = upper(code)
        AND (w.tenant_id IS NOT DISTINCT FROM parked.tenant_id OR w.tenant_id IS NULL)
      ORDER BY (w.tenant_id IS NOT NULL) DESC
      LIMIT 1;
      IF wh_id IS NULL THEN
        missing := array_append(missing, code);
      ELSE
        resolved_ids := array_append(resolved_ids, wh_id);
      END IF;
    END LOOP;

    IF array_length(missing, 1) IS NULL THEN
      -- All codes resolved — promote.
      first_scheduled := NULL;
      IF parked.stop_scheduled_at IS NOT NULL AND array_length(parked.stop_scheduled_at, 1) IS NOT NULL THEN
        SELECT s INTO first_scheduled
        FROM unnest(parked.stop_scheduled_at) AS s
        WHERE s IS NOT NULL
        LIMIT 1;
      END IF;

      INSERT INTO public.jobs (
        reference, status, origin_warehouse_id, destination_warehouse_id,
        scheduled_at, equipment_type, tenant_id
      ) VALUES (
        parked.reference, 'PENDING',
        resolved_ids[1], resolved_ids[array_length(resolved_ids, 1)],
        first_scheduled, parked.equipment_type, parked.tenant_id
      ) RETURNING id INTO new_job_id;

      FOR i IN 1 .. array_length(resolved_ids, 1) LOOP
        INSERT INTO public.job_stops (job_id, seq, kind, warehouse_id, scheduled_at)
        VALUES (
          new_job_id,
          i,
          CASE WHEN i = array_length(resolved_ids, 1) THEN 'DROP'::stop_kind ELSE 'PICKUP'::stop_kind END,
          resolved_ids[i],
          CASE WHEN parked.stop_scheduled_at IS NOT NULL
                 AND i <= COALESCE(array_length(parked.stop_scheduled_at, 1), 0)
               THEN parked.stop_scheduled_at[i] ELSE NULL END
        );
      END LOOP;

      DELETE FROM public.pending_job_imports WHERE id = parked.id;
    ELSE
      UPDATE public.pending_job_imports
      SET missing_codes = missing
      WHERE id = parked.id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER warehouses_promote_pending_imports
  AFTER INSERT ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.promote_pending_imports_for_warehouse();

-- 3. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_job_imports;
