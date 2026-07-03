-- Driver device binding (anti code-sharing): one active device per login code.
-- Additive + idempotent. The pairing-login endpoint records the device that
-- last signed in with a driver's code; any other device self-ejects because its
-- device id no longer matches. Regenerating the code clears the binding.
alter table public.drivers add column if not exists bound_device_id text;
alter table public.drivers add column if not exists bound_device_at timestamptz;
