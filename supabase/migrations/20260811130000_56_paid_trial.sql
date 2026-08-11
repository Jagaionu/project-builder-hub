-- ============================================================
-- MIGRATION #56: Paid-trial support (behind a flag; existing companies grandfathered).
-- Additive + idempotent.
--  * companies.requires_trial_payment: set true only for NEW signups made while
--    the paid trial is enabled. Existing companies stay false (grandfathered).
--  * companies.trial_paid: true once the trial fee has been paid.
--  * trial_config.paid_trial_enabled: master switch for the paid-trial flow.
-- ============================================================
alter table public.companies add column if not exists requires_trial_payment boolean not null default false;
alter table public.companies add column if not exists trial_paid boolean not null default false;
alter table public.trial_config add column if not exists paid_trial_enabled boolean not null default false;
