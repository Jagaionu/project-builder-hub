UPDATE public.companies
SET subscription_ends_at = now() + INTERVAL '14 days'
WHERE subscription_status = 'trial'
  AND subscription_ends_at IS NULL;
