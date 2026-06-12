-- ============================================================
-- MIGRATION #37: Billing foundation. Additive + idempotent.
-- Adds the payment/billing domain: price book, provider fee
-- config, payment methods, invoices (+ line items), append-only
-- payment event log, idempotency store, webhook landing zone
-- (dead-letter), dunning email log, and bank-transfer
-- reconciliation audit log. GBP-only for now.
--
-- Money is ALWAYS stored as integer minor units (pence). No floats.
-- Tenant tables mirror the existing RLS pattern: tenants read their
-- own rows; all writes are super-admin/service-role managed.
-- ============================================================

-- ── 1. companies: billing columns ───────────────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS billing_provider     TEXT
  CHECK (billing_provider IN ('stripe','gocardless','bank_transfer'));
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS billing_customer_ref TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS billing_status       TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS current_period_end   TIMESTAMPTZ;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS country_code         TEXT NOT NULL DEFAULT 'GB';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS vat_number           TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS vat_validated_at     TIMESTAMPTZ;

-- ── 2. plan_prices: the price book (super-admin editable) ────
CREATE TABLE IF NOT EXISTS public.plan_prices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan             text NOT NULL CHECK (plan IN ('starter','pro','enterprise')),
  interval         text NOT NULL CHECK (interval IN ('monthly','annual')),
  currency         text NOT NULL DEFAULT 'GBP',
  net_amount_minor integer NOT NULL CHECK (net_amount_minor >= 0),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- One active price per (plan, interval, currency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_prices_active
  ON public.plan_prices (plan, interval, currency) WHERE active;

-- ── 3. provider_fee_config: fee schedule for gross-up ────────
-- percentage_bp = basis points (150 = 1.5%). cap_minor optional.
CREATE TABLE IF NOT EXISTS public.provider_fee_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL CHECK (provider IN ('stripe','gocardless','bank_transfer')),
  card_region     text NOT NULL DEFAULT 'any' CHECK (card_region IN ('uk','eu','intl','any')),
  percentage_bp   integer NOT NULL DEFAULT 0 CHECK (percentage_bp >= 0),
  fixed_fee_minor integer NOT NULL DEFAULT 0 CHECK (fixed_fee_minor >= 0),
  cap_minor       integer CHECK (cap_minor IS NULL OR cap_minor >= 0),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_fee_active
  ON public.provider_fee_config (provider, card_region) WHERE active;

-- ── 4. payment_methods (tenant-scoped) ───────────────────────
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('stripe','gocardless','bank_transfer')),
  provider_ref text,
  kind         text NOT NULL CHECK (kind IN ('card','bank_account','mandate')),
  brand        text,
  bank_name    text,
  last4        text,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('pending','active','failed','cancelled','expired')),
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant ON public.payment_methods (tenant_id);

-- ── 5. invoices (tenant-scoped) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                  text,
  tenant_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider             text NOT NULL CHECK (provider IN ('stripe','gocardless','bank_transfer')),
  provider_invoice_ref text,
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','open','paid','failed','void','refunded','uncollectible')),
  currency             text NOT NULL DEFAULT 'GBP',
  -- Money breakdown: gross = net + tax + fee. All integer minor units.
  net_amount_minor     integer NOT NULL DEFAULT 0 CHECK (net_amount_minor >= 0),
  tax_amount_minor     integer NOT NULL DEFAULT 0 CHECK (tax_amount_minor >= 0),
  fee_amount_minor     integer NOT NULL DEFAULT 0 CHECK (fee_amount_minor >= 0),
  gross_amount_minor   integer NOT NULL DEFAULT 0 CHECK (gross_amount_minor >= 0),
  tax_rate_bp          integer NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),
  tax_calculation_method text NOT NULL DEFAULT 'standard'
                         CHECK (tax_calculation_method IN ('standard','reverse_charge','zero_rated','exempt')),
  plan                 text CHECK (plan IN ('starter','pro','enterprise')),
  interval             text CHECK (interval IN ('monthly','annual')),
  period_start         timestamptz,
  period_end           timestamptz,
  due_date             timestamptz,
  paid_at              timestamptz,
  payment_reference    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created ON public.invoices (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices (status);
-- payment_reference must be unique when present (bank-transfer matching).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_payment_reference
  ON public.invoices (payment_reference) WHERE payment_reference IS NOT NULL;

-- Generate a human invoice ref + keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.invoice_set_ref()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.ref IS NULL THEN NEW.ref := 'INV-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8)); END IF;
  NEW.updated_at := now();
  IF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN NEW.paid_at := now(); END IF;
  RETURN NEW;
END; $fn$;
DROP TRIGGER IF EXISTS trg_invoice_ref ON public.invoices;
CREATE TRIGGER trg_invoice_ref BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoice_set_ref();

-- ── 6. invoice_line_items (tenant-scoped) ────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('subscription','proration','fee','tax','credit','adjustment')),
  description  text NOT NULL,
  quantity     integer NOT NULL DEFAULT 1,
  amount_minor integer NOT NULL,  -- may be negative (credits)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON public.invoice_line_items (invoice_id);

-- ── 7. payment_events: append-only audit log ─────────────────
CREATE TABLE IF NOT EXISTS public.payment_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  invoice_id  uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  provider    text,
  event_type  text NOT NULL,
  actor       text,            -- 'system' | 'webhook' | super-admin user id
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_tenant_created ON public.payment_events (tenant_id, created_at DESC);

-- ── 8. billing_idempotency: dedupe billing operations ────────
CREATE TABLE IF NOT EXISTS public.billing_idempotency (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  operation_type  text NOT NULL,
  company_id      uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key, operation_type)
);

-- ── 9. webhook_incoming: signature-verified landing zone ─────
-- Raw events persisted BEFORE business logic so failures can be replayed.
CREATE TABLE IF NOT EXISTS public.webhook_incoming (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL CHECK (provider IN ('stripe','gocardless')),
  event_id     text,
  signature    text,
  headers      jsonb,
  raw_body     text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  error        text
);
-- Idempotent ingest: one row per (provider, event_id) when event_id present.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_incoming_event
  ON public.webhook_incoming (provider, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_incoming_pending
  ON public.webhook_incoming (received_at) WHERE processed_at IS NULL;

-- ── 10. dunning_emails: failed-payment email log ─────────────
CREATE TABLE IF NOT EXISTS public.dunning_emails (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id          uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  template_key        text NOT NULL,
  status              text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','skipped')),
  provider_message_id text,
  sent_at             timestamptz NOT NULL DEFAULT now()
);
-- Never send the same dunning step twice for the same invoice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dunning_invoice_template
  ON public.dunning_emails (invoice_id, template_key) WHERE invoice_id IS NOT NULL;

-- ── 11. billing_reconciliation_log: bank-transfer audit ──────
CREATE TABLE IF NOT EXISTS public.billing_reconciliation_log (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id               uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  admin_user_id            uuid NOT NULL,
  matched_amount_minor     integer NOT NULL CHECK (matched_amount_minor >= 0),
  bank_statement_reference text NOT NULL,
  proof_attachment_url     text,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_invoice ON public.billing_reconciliation_log (invoice_id);

-- ── 12. updated_at triggers ──────────────────────────────────
DROP TRIGGER IF EXISTS plan_prices_updated_at ON public.plan_prices;
CREATE TRIGGER plan_prices_updated_at BEFORE UPDATE ON public.plan_prices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS provider_fee_config_updated_at ON public.provider_fee_config;
CREATE TRIGGER provider_fee_config_updated_at BEFORE UPDATE ON public.provider_fee_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS payment_methods_updated_at ON public.payment_methods;
CREATE TRIGGER payment_methods_updated_at BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── 13. RLS ──────────────────────────────────────────────────
-- Tenant-scoped: tenants read their own rows; writes are super-admin only
-- (service role bypasses RLS for system/webhook operations).
ALTER TABLE public.payment_methods            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dunning_emails             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_reconciliation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_prices                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_fee_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_idempotency        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_incoming           ENABLE ROW LEVEL SECURITY;

-- payment_methods
DROP POLICY IF EXISTS payment_methods_select ON public.payment_methods;
CREATE POLICY payment_methods_select ON public.payment_methods FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS payment_methods_admin_all ON public.payment_methods;
CREATE POLICY payment_methods_admin_all ON public.payment_methods FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- invoices
DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS invoices_admin_all ON public.invoices;
CREATE POLICY invoices_admin_all ON public.invoices FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- invoice_line_items
DROP POLICY IF EXISTS invoice_line_items_select ON public.invoice_line_items;
CREATE POLICY invoice_line_items_select ON public.invoice_line_items FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS invoice_line_items_admin_all ON public.invoice_line_items;
CREATE POLICY invoice_line_items_admin_all ON public.invoice_line_items FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- payment_events (read own; insert/admin via service role)
DROP POLICY IF EXISTS payment_events_select ON public.payment_events;
CREATE POLICY payment_events_select ON public.payment_events FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS payment_events_admin_all ON public.payment_events;
CREATE POLICY payment_events_admin_all ON public.payment_events FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- dunning_emails
DROP POLICY IF EXISTS dunning_emails_select ON public.dunning_emails;
CREATE POLICY dunning_emails_select ON public.dunning_emails FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS dunning_emails_admin_all ON public.dunning_emails;
CREATE POLICY dunning_emails_admin_all ON public.dunning_emails FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- billing_reconciliation_log
DROP POLICY IF EXISTS reconciliation_select ON public.billing_reconciliation_log;
CREATE POLICY reconciliation_select ON public.billing_reconciliation_log FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS reconciliation_admin_all ON public.billing_reconciliation_log;
CREATE POLICY reconciliation_admin_all ON public.billing_reconciliation_log FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- plan_prices: readable by any authenticated user (to render pricing); writes super-admin.
DROP POLICY IF EXISTS plan_prices_select ON public.plan_prices;
CREATE POLICY plan_prices_select ON public.plan_prices FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS plan_prices_admin_all ON public.plan_prices;
CREATE POLICY plan_prices_admin_all ON public.plan_prices FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- provider_fee_config, billing_idempotency, webhook_incoming: super-admin only.
DROP POLICY IF EXISTS provider_fee_config_admin_all ON public.provider_fee_config;
CREATE POLICY provider_fee_config_admin_all ON public.provider_fee_config FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS billing_idempotency_admin_all ON public.billing_idempotency;
CREATE POLICY billing_idempotency_admin_all ON public.billing_idempotency FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS webhook_incoming_admin_all ON public.webhook_incoming;
CREATE POLICY webhook_incoming_admin_all ON public.webhook_incoming FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ── 14. Seed: default GBP price book + provider fee schedule ──
-- Prices are placeholders (super admin can edit). Stored in pence.
INSERT INTO public.plan_prices (plan, interval, currency, net_amount_minor)
VALUES
  ('starter',   'monthly', 'GBP', 10000),   -- £100.00
  ('pro',       'monthly', 'GBP', 60000),   -- £600.00
  ('enterprise','monthly', 'GBP', 150000)   -- £1,500.00
ON CONFLICT DO NOTHING;

-- Fee schedule (verify against live contracts; super admin can edit):
--  GoCardless UK: 1% + £0.20, capped £4.00
--  Stripe UK card: 1.5% + £0.20
--  Bank transfer: no fee
INSERT INTO public.provider_fee_config (provider, card_region, percentage_bp, fixed_fee_minor, cap_minor)
VALUES
  ('gocardless',   'any', 100, 20, 400),
  ('stripe',       'uk',  150, 20, NULL),
  ('stripe',       'eu',  250, 20, NULL),
  ('stripe',       'intl',250, 20, NULL),
  ('bank_transfer','any', 0,   0,  NULL)
ON CONFLICT DO NOTHING;
