-- ============================================================
-- MIGRATION #57: record the trial fee paid, for crediting at auto-convert.
-- Additive + idempotent.
-- ============================================================
alter table public.companies add column if not exists trial_fee_paid_minor int;
