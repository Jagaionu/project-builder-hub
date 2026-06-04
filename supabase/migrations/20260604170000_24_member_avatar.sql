-- ============================================================
-- MIGRATION #24: company_members.avatar_url (optional profile picture)
-- Additive + idempotent. The 'avatars' storage bucket was created in #23.
-- ============================================================
ALTER TABLE public.company_members
  ADD COLUMN IF NOT EXISTS avatar_url text;
