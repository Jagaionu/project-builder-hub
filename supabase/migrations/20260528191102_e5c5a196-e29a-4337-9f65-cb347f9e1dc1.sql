-- ============================================================
-- MIGRATION: fix_promote_pending_imports_for_global_warehouses
--
-- BUG: The trigger condition
--
--   WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
--
-- means: when a GLOBAL warehouse is added (NEW.tenant_id = NULL)
-- only parked imports that also have tenant_id = NULL are scanned.
-- But all company parked imports have tenant_id = 'some-uuid', so
-- they are never promoted even though they are waiting for that code.
--
-- FIX: When NEW.tenant_id IS NULL (global warehouse), the trigger
-- must scan ALL tenants' parked imports for that code.
-- When NEW.tenant_id IS NOT NULL (tenant-specific), only scan
-- imports for that specific tenant.
--
-- Also runs a one-time re-scan to promote all parked rows that are
-- currently stuck because they were waiting for a warehouse that
-- has since been added but the trigger never fired for them.
-- ============================================================

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
  -- Scan pending imports that are waiting for this warehouse code.
  -- A GLOBAL warehouse (NEW.tenant_id IS NULL) can unblock ANY tenant.
  -- A tenant-specific warehouse can only unblock its own tenant.
  FOR parked IN
    SELECT *
    FROM public.pending_job_imports
    WHERE upper(NEW.code) = ANY (SELECT upper(c) FROM unnest(missing_codes) AS c)
      AND (
        NEW.tenant_id IS NULL                   -- global: unblocks all tenants
        OR tenant_id = NEW.tenant_id            -- tenant-specific: unblocks own tenant
      )
  LOOP
    -- Re-resolve every code in the lane against warehouses visible to this tenant.
    -- Prefer tenant-specific warehouses over global ones (same code, different location).
    codes := string_to_array(parked.lane, '->');
    missing := '{}';
    resolved_ids := '{}';
    FOREACH code IN ARRAY codes LOOP
      code := trim(code);
      IF code = '' THEN CONTINUE; END IF;
      SELECT w.id INTO wh_id
      FROM public.warehouses w
      WHERE upper(w.code) = upper(code)
        AND (
          w.tenant_id = parked.tenant_id   -- tenant-specific first
          OR w.tenant_id IS NULL           -- then global
        )
      ORDER BY (w.tenant_id IS NOT NULL) DESC   -- tenant-specific wins tie
      LIMIT 1;
      IF wh_id IS NULL THEN
        missing := array_append(missing, code);
      ELSE
        resolved_ids := array_append(resolved_ids, wh_id);
      END IF;
    END LOOP;

    IF array_length(missing, 1) IS NULL THEN
      -- All codes resolved — promote to a real job.
      first_scheduled := NULL;
      IF parked.stop_scheduled_at IS NOT NULL AND array_length(parked.stop_scheduled_at, 1) IS NOT NULL THEN
        SELECT s INTO first_scheduled
        FROM unnest(parked.stop_scheduled_at) AS s
        WHERE s IS NOT NULL
        LIMIT 1;
      END IF;

      INSERT INTO public.jobs (
        reference, status, origin_warehouse_id, destination_warehouse_id,
        scheduled_at, equipment_type, tenant_id, import_batch_id
      ) VALUES (
        parked.reference, 'PENDING',
        resolved_ids[1], resolved_ids[array_length(resolved_ids, 1)],
        first_scheduled, parked.equipment_type, parked.tenant_id,
        parked.import_batch_id
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
      -- Still missing some — update the list in case some have been resolved.
      UPDATE public.pending_job_imports
      SET missing_codes = missing
      WHERE id = parked.id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── One-time repair: promote all currently stuck parked imports ────────────
--
-- For every parked row, re-resolve all its codes against current warehouses.
-- Rows that can now be fully resolved get promoted to jobs.
-- Rows with remaining missing codes get their missing_codes list refreshed.

DO $$
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
  FOR parked IN SELECT * FROM public.pending_job_imports LOOP
    codes := string_to_array(parked.lane, '->');
    missing := '{}';
    resolved_ids := '{}';

    FOREACH code IN ARRAY codes LOOP
      code := trim(code);
      IF code = '' THEN CONTINUE; END IF;
      SELECT w.id INTO wh_id
      FROM public.warehouses w
      WHERE upper(w.code) = upper(code)
        AND (w.tenant_id = parked.tenant_id OR w.tenant_id IS NULL)
      ORDER BY (w.tenant_id IS NOT NULL) DESC
      LIMIT 1;
      IF wh_id IS NULL THEN
        missing := array_append(missing, code);
      ELSE
        resolved_ids := array_append(resolved_ids, wh_id);
      END IF;
    END LOOP;

    IF array_length(missing, 1) IS NULL THEN
      -- All resolved — promote.
      first_scheduled := NULL;
      IF parked.stop_scheduled_at IS NOT NULL AND array_length(parked.stop_scheduled_at, 1) IS NOT NULL THEN
        SELECT s INTO first_scheduled FROM unnest(parked.stop_scheduled_at) AS s WHERE s IS NOT NULL LIMIT 1;
      END IF;

      -- Skip if the reference already exists as a job.
      IF EXISTS (SELECT 1 FROM public.jobs WHERE reference = parked.reference AND tenant_id = parked.tenant_id) THEN
        DELETE FROM public.pending_job_imports WHERE id = parked.id;
        CONTINUE;
      END IF;

      INSERT INTO public.jobs (
        reference, status, origin_warehouse_id, destination_warehouse_id,
        scheduled_at, equipment_type, tenant_id, import_batch_id
      ) VALUES (
        parked.reference, 'PENDING',
        resolved_ids[1], resolved_ids[array_length(resolved_ids, 1)],
        first_scheduled, parked.equipment_type, parked.tenant_id,
        parked.import_batch_id
      ) RETURNING id INTO new_job_id;

      FOR i IN 1 .. array_length(resolved_ids, 1) LOOP
        INSERT INTO public.job_stops (job_id, seq, kind, warehouse_id, scheduled_at)
        VALUES (
          new_job_id, i,
          CASE WHEN i = array_length(resolved_ids, 1) THEN 'DROP'::stop_kind ELSE 'PICKUP'::stop_kind END,
          resolved_ids[i],
          CASE WHEN parked.stop_scheduled_at IS NOT NULL
                 AND i <= COALESCE(array_length(parked.stop_scheduled_at, 1), 0)
               THEN parked.stop_scheduled_at[i] ELSE NULL END
        );
      END LOOP;

      DELETE FROM public.pending_job_imports WHERE id = parked.id;
    ELSE
      -- Refresh missing_codes with accurate current list.
      UPDATE public.pending_job_imports SET missing_codes = missing WHERE id = parked.id;
    END IF;
  END LOOP;
END;
$$;
