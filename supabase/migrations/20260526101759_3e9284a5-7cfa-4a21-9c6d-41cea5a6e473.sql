CREATE TABLE IF NOT EXISTS public.driver_push_subscriptions (
  driver_id   UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "driver_own_push_sub" ON public.driver_push_subscriptions
  FOR ALL
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

CREATE POLICY "super_admin_read_push_sub" ON public.driver_push_subscriptions
  FOR SELECT
  USING (public.is_super_admin());