-- ============================================================
-- MIGRATION #53: Super-admin security — recovery codes + immutable audit log.
-- Additive + idempotent.
--  * super_admin_recovery_codes: one-time MFA recovery codes (hashed).
--  * super_admin_audit: append-only, immutable log of privileged actions.
-- Both are written server-side via the service role (which bypasses RLS).
-- ============================================================

-- One-time recovery codes (hashed; plaintext shown once at generation).
create table if not exists public.super_admin_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_sarc_user on public.super_admin_recovery_codes (user_id);

-- RLS on, no policies: clients cannot read/write (server-only via service role).
alter table public.super_admin_recovery_codes enable row level security;

-- Immutable audit log of privileged super-admin actions.
create table if not exists public.super_admin_audit (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  actor_user_id uuid,
  actor_email   text,
  category      text not null,   -- auth | security | administration | billing | data
  action        text not null,
  detail        jsonb not null default '{}'::jsonb,
  ip            text,
  user_agent    text
);
create index if not exists idx_saa_created on public.super_admin_audit (created_at desc);
create index if not exists idx_saa_actor on public.super_admin_audit (actor_user_id, created_at desc);

alter table public.super_admin_audit enable row level security;

-- Super admins may READ the audit log. There are deliberately NO insert/update/
-- delete policies, so it is immutable from any client; the service role writes
-- entries and bypasses RLS.
drop policy if exists super_admin_audit_read on public.super_admin_audit;
create policy super_admin_audit_read on public.super_admin_audit for select to authenticated
  using (public.is_super_admin());
