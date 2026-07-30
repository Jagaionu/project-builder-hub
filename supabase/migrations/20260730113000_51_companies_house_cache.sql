-- ============================================================
-- MIGRATION #51: Companies House response cache (24h).
-- Additive + idempotent. Reduces Companies House API load and speeds up the
-- signup company picker. Server-only: RLS is enabled with NO policies, so only
-- the service role (which bypasses RLS) can read/write it.
-- ============================================================
create table if not exists public.companies_house_cache (
  cache_key  text primary key,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.companies_house_cache enable row level security;
