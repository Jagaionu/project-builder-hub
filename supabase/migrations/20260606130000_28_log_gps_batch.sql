-- MIGRATION #28: JWT-secured batch GPS ingestion (log_gps)
-- Identity from auth.uid() -> drivers.user_id; payload driver_id ignored (closes IDOR).
-- Writes to driver_positions (tenant from driver row) + refreshes drivers last-known pos.
-- Additive + idempotent.

ALTER TABLE public.driver_positions
  ADD COLUMN IF NOT EXISTS accuracy double precision,
  ADD COLUMN IF NOT EXISTS speed    double precision,
  ADD COLUMN IF NOT EXISTS bearing  double precision;

CREATE OR REPLACE FUNCTION public.log_gps(points jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_tenant_id uuid;
  v_inserted  int := 0;
  v_last_lat  double precision;
  v_last_lon  double precision;
  v_last_t    timestamptz;
BEGIN
  SELECT d.id, d.tenant_id INTO v_driver_id, v_tenant_id
  FROM public.drivers d WHERE d.user_id = auth.uid() LIMIT 1;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'log_gps: no driver linked to current user' USING errcode = '42501';
  END IF;
  IF points IS NULL OR jsonb_typeof(points) <> 'array' THEN
    RAISE EXCEPTION 'log_gps: points must be a JSON array';
  END IF;

  WITH parsed AS (
    SELECT
      (p->>'latitude')::double precision  AS lat,
      (p->>'longitude')::double precision AS lon,
      COALESCE(CASE WHEN (p->>'time') ~ '^\d+$'
        THEN to_timestamp(((p->>'time')::bigint)/1000.0)
        ELSE (p->>'time')::timestamptz END, now()) AS t,
      NULLIF(p->>'accuracy','')::double precision AS accuracy,
      NULLIF(p->>'speed','')::double precision    AS speed,
      NULLIF(p->>'bearing','')::double precision  AS bearing
    FROM jsonb_array_elements(points) AS p
    WHERE (p ? 'latitude') AND (p ? 'longitude')
      AND (p->>'latitude')  ~ '^-?[0-9]+(\.[0-9]+)?$'
      AND (p->>'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
  )
  INSERT INTO public.driver_positions
    (driver_id, tenant_id, lat, lon, created_at, accuracy, speed, bearing)
  SELECT v_driver_id, v_tenant_id, lat, lon, t, accuracy, speed, bearing FROM parsed;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT lat, lon, t INTO v_last_lat, v_last_lon, v_last_t
  FROM (
    SELECT
      (p->>'latitude')::double precision  AS lat,
      (p->>'longitude')::double precision AS lon,
      COALESCE(CASE WHEN (p->>'time') ~ '^\d+$'
        THEN to_timestamp(((p->>'time')::bigint)/1000.0)
        ELSE (p->>'time')::timestamptz END, now()) AS t
    FROM jsonb_array_elements(points) AS p
    WHERE (p ? 'latitude') AND (p ? 'longitude')
      AND (p->>'latitude')  ~ '^-?[0-9]+(\.[0-9]+)?$'
      AND (p->>'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
    ORDER BY t DESC LIMIT 1
  ) latest;

  IF v_last_lat IS NOT NULL THEN
    UPDATE public.drivers
       SET current_lat = v_last_lat, current_lon = v_last_lon, last_update_time = v_last_t
     WHERE id = v_driver_id;
  END IF;

  RETURN jsonb_build_object('inserted', v_inserted);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_gps(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_gps(jsonb) TO authenticated;
