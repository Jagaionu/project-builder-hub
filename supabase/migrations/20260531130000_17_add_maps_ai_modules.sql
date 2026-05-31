-- ============================================================
-- Add "maps" and "ai_agent" to company config modules.
--
-- 1. Update the column DEFAULT so new companies get them.
-- 2. Backfill existing companies that are missing either one.
-- ============================================================

BEGIN;

-- Update column default for new companies
ALTER TABLE public.companies
  ALTER COLUMN config SET DEFAULT '{
    "modules": ["dispatch","jobs","drivers","warehouses","alerts","events","maps","ai_agent"],
    "maxDrivers": 20,
    "maxWarehouses": 5,
    "showTelegramAlerts": true,
    "showComplianceModule": true,
    "customBranding": false,
    "brandName": null,
    "brandColor": null
  }'::jsonb;

-- Backfill existing companies — union existing modules with the two new ones
UPDATE public.companies
SET config = jsonb_set(
  config,
  '{modules}',
  (
    SELECT COALESCE(jsonb_agg(m), '[]'::jsonb)
    FROM (
      SELECT jsonb_array_elements_text(config->'modules') AS m
      UNION
      SELECT 'maps'
      UNION
      SELECT 'ai_agent'
    ) all_mods
  )
)
WHERE
  NOT (config->'modules' ? 'maps')
  OR NOT (config->'modules' ? 'ai_agent');

COMMIT;
