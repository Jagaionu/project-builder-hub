-- ============================================================
-- MIGRATION #55: Trial fee configuration (super-admin editable, no redeploy).
-- Additive + idempotent. Single-row config for the paid trial. The ongoing
-- subscription price is unchanged (still set via plan_prices / per-company
-- override). Amounts are ex-VAT, minor units (pence).
-- ============================================================
create table if not exists public.trial_config (
  id                 int primary key default 1,
  currency           text not null default 'GBP',
  trial_7_fee_minor  int not null default 1000,
  trial_14_fee_minor int not null default 3000,
  default_trial_days int not null default 7,
  updated_at         timestamptz not null default now(),
  constraint trial_config_singleton check (id = 1)
);

insert into public.trial_config (id) values (1) on conflict (id) do nothing;

drop trigger if exists trial_config_updated_at on public.trial_config;
create trigger trial_config_updated_at before update on public.trial_config
  for each row execute function public.touch_updated_at();

alter table public.trial_config enable row level security;

drop policy if exists trial_config_read on public.trial_config;
create policy trial_config_read on public.trial_config for select to authenticated using (true);
drop policy if exists trial_config_admin_write on public.trial_config;
create policy trial_config_admin_write on public.trial_config for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
