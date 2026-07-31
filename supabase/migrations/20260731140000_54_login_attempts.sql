-- ============================================================
-- MIGRATION #54: App-level login attempt tracking (rate limiting).
-- Additive + idempotent. Server-only (RLS on, no policies). Feeds the
-- pre-login throttle as defence-in-depth over Supabase's own auth limits.
-- ============================================================
create table if not exists public.login_attempts (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  ip         text,
  outcome    text,   -- failed | success
  created_at timestamptz not null default now()
);
create index if not exists idx_login_attempts_ip on public.login_attempts (ip, created_at desc);
create index if not exists idx_login_attempts_email on public.login_attempts (lower(email), created_at desc);

alter table public.login_attempts enable row level security;
