-- ============================================================
-- MIGRATION #27: route_notes.author_avatar_url — note author's profile picture
-- Additive + idempotent. Denormalized from the author's company_members avatar
-- at write time so notes render the picture without a per-row lookup.
-- ============================================================
ALTER TABLE public.route_notes
  ADD COLUMN IF NOT EXISTS author_avatar_url text;
