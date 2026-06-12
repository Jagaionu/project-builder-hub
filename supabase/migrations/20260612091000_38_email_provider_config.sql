-- ============================================================
-- MIGRATION #38: Email provider config (super-admin managed).
-- Powers dunning / transactional billing emails. The API key is set
-- from the super-admin dashboard. Single active row at a time.
-- Additive + idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_provider_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL CHECK (provider IN ('resend','postmark','ses')),
  api_key       text,                       -- secret; super-admin only via RLS
  from_email    text NOT NULL,
  from_name     text,
  reply_to      text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Only one active provider config.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_provider_active
  ON public.email_provider_config (active) WHERE active;

DROP TRIGGER IF EXISTS email_provider_config_updated_at ON public.email_provider_config;
CREATE TRIGGER email_provider_config_updated_at BEFORE UPDATE ON public.email_provider_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: super-admin only (contains a secret API key).
ALTER TABLE public.email_provider_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_provider_config_admin_all ON public.email_provider_config;
CREATE POLICY email_provider_config_admin_all ON public.email_provider_config FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
