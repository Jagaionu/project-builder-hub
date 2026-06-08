-- MIGRATION #35: identities on support tickets/messages (avatars + assignee).
-- Additive + idempotent. URLs are denormalised at write time (avatarUrl from the
-- session) so the thread/list can show who raised and who is handling a case.
ALTER TABLE public.support_tickets        ADD COLUMN IF NOT EXISTS created_by_avatar text;
ALTER TABLE public.support_tickets        ADD COLUMN IF NOT EXISTS assigned_name     text;
ALTER TABLE public.support_tickets        ADD COLUMN IF NOT EXISTS assigned_avatar   text;
ALTER TABLE public.support_ticket_messages ADD COLUMN IF NOT EXISTS author_avatar     text;
