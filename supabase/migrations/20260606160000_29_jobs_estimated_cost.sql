-- MIGRATION #29: jobs.estimated_cost (FMC bulk-upload "Estimated Cost", e.g. "310.68 GBP").
-- Stored as raw text to preserve amount + currency exactly. Additive + idempotent.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS estimated_cost text;
