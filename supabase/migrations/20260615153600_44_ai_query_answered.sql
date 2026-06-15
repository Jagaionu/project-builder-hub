-- MIGRATION #44: capture the AI answer + whether the question was actually
-- answered, so the super admin can review the "I don't know" gaps and turn
-- them into knowledge-base content. Additive + idempotent.
ALTER TABLE public.ai_query_logs ADD COLUMN IF NOT EXISTS answer   text;
ALTER TABLE public.ai_query_logs ADD COLUMN IF NOT EXISTS answered boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_answered_created
  ON public.ai_query_logs (answered, created_at DESC);
