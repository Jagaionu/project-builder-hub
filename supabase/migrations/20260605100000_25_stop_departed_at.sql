-- ============================================================
-- MIGRATION #25: job_stops.departed_at — actual GPS-derived departure time
-- Additive + idempotent. Set by the driver app's leg tracker when the driver
-- physically leaves a stop's geofence (backdated one ping interval). Powers
-- accurate transit-time learning and a "departed early" display.
-- ============================================================
ALTER TABLE public.job_stops
  ADD COLUMN IF NOT EXISTS departed_at timestamptz;
