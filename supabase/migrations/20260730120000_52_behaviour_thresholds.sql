-- ============================================================
-- MIGRATION #52: Behavioural risk thresholds (configurable).
-- Additive + idempotent. Adds tunable 24h behaviour thresholds to the existing
-- fraud_settings row so the behavioural sweep is configurable without a deploy.
-- ============================================================
alter table public.fraud_settings add column if not exists behaviour_max_devices_24h   int not null default 5;
alter table public.fraud_settings add column if not exists behaviour_max_countries_24h int not null default 3;
alter table public.fraud_settings add column if not exists behaviour_max_jobs_24h       int not null default 300;
alter table public.fraud_settings add column if not exists behaviour_max_drivers_24h    int not null default 30;
