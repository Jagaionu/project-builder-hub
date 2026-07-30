-- ============================================================
-- MIGRATION #50: Trial-abuse prevention foundation.
-- Additive + idempotent. Adds company identity/verification, a PERMANENT
-- signup ledger (fraud history, never deleted), signup event history,
-- per-signup decision audit, post-signup behavioural risk events, seeded
-- email-domain signals, and DB-backed fraud settings (every weight, threshold,
-- cooldown and rate-limit tunable from the dashboard with no code change).
-- ============================================================

-- 1. companies identity + verification status
alter table public.companies add column if not exists company_number text;
alter table public.companies add column if not exists company_house_name text;
alter table public.companies add column if not exists director_name text;
alter table public.companies add column if not exists verification_method text; -- companies_house | manual
alter table public.companies add column if not exists verification_status text; -- pending_review | verified | trusted | blocked
create index if not exists idx_companies_company_number on public.companies (company_number) where company_number is not null;
create index if not exists idx_companies_verification_status on public.companies (verification_status);

-- 2. PERMANENT signup ledger (never deleted; survives company deletion -> no FK)
create table if not exists public.trial_signups (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  tenant_id           uuid,
  email               text,
  normalized_email    text,
  email_domain        text,
  company_number      text,
  company_name        text,
  director_name       text,
  verification_method text,
  identity_trust      int not null default 0,
  fraud_risk          int not null default 0,
  decision            text,   -- active | pending_review | blocked
  status              text,   -- approved | pending_review | blocked
  reason              jsonb not null default '{}'::jsonb,
  ip                  text,
  device_id           text,
  user_agent          text,
  last_trial_at       timestamptz
);
create index if not exists idx_trial_signups_company_number on public.trial_signups (company_number);
create index if not exists idx_trial_signups_normalized_email on public.trial_signups (normalized_email);
create index if not exists idx_trial_signups_created_at on public.trial_signups (created_at desc);

-- 3. signup event history (every attempt) -> historical fingerprints + rate limiting
create table if not exists public.signup_events (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  email          text,
  email_domain   text,
  company_number text,
  ip             text,
  device_id      text,
  user_agent     text,
  fingerprint    text,
  outcome        text   -- attempt | created | blocked | rate_limited | pending_review
);
create index if not exists idx_signup_events_ip_created on public.signup_events (ip, created_at desc);
create index if not exists idx_signup_events_device_created on public.signup_events (device_id, created_at desc);

-- 4. per-signup decision audit (append-only)
create table if not exists public.signup_decision_log (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  signup_id  uuid,
  tenant_id  uuid,
  step       text not null,   -- rate_limit | companies_house | duplicate_check | scoring | decision | review_action
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists idx_signup_decision_log_signup on public.signup_decision_log (signup_id, created_at);
create index if not exists idx_signup_decision_log_tenant on public.signup_decision_log (tenant_id, created_at);

-- 5. post-signup behavioural risk events
create table if not exists public.trial_risk_events (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id  uuid,
  signal     text not null,             -- multi_device | multi_country | job_spike | driver_spike | never_logged_in | ...
  severity   text not null default 'medium',  -- high | medium | low
  points     int not null default 0,
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists idx_trial_risk_events_tenant on public.trial_risk_events (tenant_id, created_at desc);

-- 6. email-domain signals (seeded; super-admin editable). kind: free | disposable
create table if not exists public.email_domain_signals (
  domain     text primary key,
  kind       text not null check (kind in ('free','disposable')),
  created_at timestamptz not null default now()
);
insert into public.email_domain_signals (domain, kind) values
  ('gmail.com','free'),('googlemail.com','free'),('outlook.com','free'),('outlook.co.uk','free'),
  ('hotmail.com','free'),('hotmail.co.uk','free'),('live.com','free'),('live.co.uk','free'),
  ('yahoo.com','free'),('yahoo.co.uk','free'),('ymail.com','free'),('icloud.com','free'),
  ('me.com','free'),('mac.com','free'),('aol.com','free'),('protonmail.com','free'),
  ('proton.me','free'),('gmx.com','free'),('gmx.co.uk','free'),('mail.com','free'),
  ('msn.com','free'),('btinternet.com','free'),('sky.com','free'),('talktalk.net','free'),
  ('mailinator.com','disposable'),('guerrillamail.com','disposable'),('10minutemail.com','disposable'),
  ('tempmail.com','disposable'),('temp-mail.org','disposable'),('yopmail.com','disposable'),
  ('trashmail.com','disposable'),('getnada.com','disposable'),('sharklasers.com','disposable'),
  ('throwawaymail.com','disposable'),('maildrop.cc','disposable'),('dispostable.com','disposable'),
  ('fakeinbox.com','disposable'),('mohmal.com','disposable'),('emailondeck.com','disposable'),
  ('discard.email','disposable'),('spam4.me','disposable')
on conflict (domain) do nothing;

-- 7. fraud settings (single-row config; tunable without a deploy)
create table if not exists public.fraud_settings (
  id                             int primary key default 1,
  risk_threshold                 int not null default 50,
  trust_min                      int not null default 100,
  cooldown_months                int not null default 24,
  rate_limit_max_attempts        int not null default 10,
  rate_limit_window_minutes      int not null default 10,
  weight_identity_ch             int not null default 100,
  weight_identity_manual         int not null default 40,
  weight_identity_business_email int not null default 20,
  weight_identity_director       int not null default 10,
  weight_risk_device             int not null default 30,
  weight_risk_ip                 int not null default 20,
  weight_risk_free_email         int not null default 15,
  weight_risk_disposable_email   int not null default 40,
  weight_risk_failed_signups     int not null default 30,
  trusted_min_paid_invoices      int not null default 3,
  trusted_min_active_days        int not null default 60,
  updated_at                     timestamptz not null default now(),
  constraint fraud_settings_singleton check (id = 1)
);
insert into public.fraud_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists fraud_settings_updated_at on public.fraud_settings;
create trigger fraud_settings_updated_at before update on public.fraud_settings
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- RLS: new tables are super-admin managed. Server-side signup runs with the
-- service role, which bypasses RLS, so ledger/event/decision inserts work.
-- ------------------------------------------------------------
alter table public.trial_signups enable row level security;
alter table public.signup_events enable row level security;
alter table public.signup_decision_log enable row level security;
alter table public.trial_risk_events enable row level security;
alter table public.email_domain_signals enable row level security;
alter table public.fraud_settings enable row level security;

drop policy if exists trial_signups_admin_all on public.trial_signups;
create policy trial_signups_admin_all on public.trial_signups for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists signup_events_admin_all on public.signup_events;
create policy signup_events_admin_all on public.signup_events for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists signup_decision_log_admin_all on public.signup_decision_log;
create policy signup_decision_log_admin_all on public.signup_decision_log for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists trial_risk_events_admin_all on public.trial_risk_events;
create policy trial_risk_events_admin_all on public.trial_risk_events for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists email_domain_signals_read on public.email_domain_signals;
create policy email_domain_signals_read on public.email_domain_signals for select to authenticated using (true);
drop policy if exists email_domain_signals_admin_write on public.email_domain_signals;
create policy email_domain_signals_admin_write on public.email_domain_signals for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists fraud_settings_read on public.fraud_settings;
create policy fraud_settings_read on public.fraud_settings for select to authenticated using (true);
drop policy if exists fraud_settings_admin_write on public.fraud_settings;
create policy fraud_settings_admin_write on public.fraud_settings for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
