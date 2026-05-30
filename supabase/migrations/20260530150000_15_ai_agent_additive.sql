-- ============================================================
-- AI Agent – Additive migration (no changes to existing RLS helpers)
-- Creates tables for knowledge, conversations, logs, pending actions,
-- and hybrid search function. Does NOT redefine current_tenant_id() or is_super_admin().
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.ai_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  chunk_text text NOT NULL,
  embedding vector(1536),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
  source_type text NOT NULL CHECK (source_type IN ('sop', 'audit_example', 'error_resolution', 'action_schema')),
  source_path text,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_global boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_embedding_hnsw
  ON public.ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_search_vector
  ON public.ai_knowledge_chunks USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_source_path
  ON public.ai_knowledge_chunks (source_path);

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  session_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_session
  ON public.ai_conversations (tenant_id, session_id, created_at);

CREATE TABLE IF NOT EXISTS public.ai_query_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  question text NOT NULL,
  retrieved_chunk_ids uuid[],
  token_usage integer,
  latency_ms integer,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  action_type text NOT NULL,
  params jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '10 minutes'
);

CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_expires
  ON public.ai_pending_actions (expires_at);

CREATE OR REPLACE FUNCTION prevent_tenant_global_mark()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_global = true AND NEW.tenant_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot mark tenant-specific chunk as global';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_global_chunk ON public.ai_knowledge_chunks;
CREATE TRIGGER check_global_chunk
  BEFORE INSERT OR UPDATE ON public.ai_knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION prevent_tenant_global_mark();

ALTER TABLE public.ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pending_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_select ON public.ai_knowledge_chunks;
CREATE POLICY ai_knowledge_select ON public.ai_knowledge_chunks
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR is_global = true OR public.is_super_admin());

DROP POLICY IF EXISTS ai_knowledge_modify ON public.ai_knowledge_chunks;
CREATE POLICY ai_knowledge_modify ON public.ai_knowledge_chunks
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS ai_conversations_select ON public.ai_conversations;
CREATE POLICY ai_conversations_select ON public.ai_conversations
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS ai_conversations_insert ON public.ai_conversations;
CREATE POLICY ai_conversations_insert ON public.ai_conversations
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS ai_query_logs_select ON public.ai_query_logs;
CREATE POLICY ai_query_logs_select ON public.ai_query_logs
  FOR SELECT TO authenticated
  USING ((tenant_id = public.current_tenant_id() AND user_id = auth.uid()) OR public.is_super_admin());

DROP POLICY IF EXISTS ai_pending_actions_select ON public.ai_pending_actions;
CREATE POLICY ai_pending_actions_select ON public.ai_pending_actions
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS ai_pending_actions_insert ON public.ai_pending_actions;
CREATE POLICY ai_pending_actions_insert ON public.ai_pending_actions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS ai_pending_actions_delete ON public.ai_pending_actions;
CREATE POLICY ai_pending_actions_delete ON public.ai_pending_actions
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_chunks TO authenticated;
GRANT SELECT, INSERT ON public.ai_conversations TO authenticated;
GRANT SELECT ON public.ai_query_logs TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.ai_pending_actions TO authenticated;

GRANT ALL ON public.ai_knowledge_chunks TO service_role;
GRANT ALL ON public.ai_conversations TO service_role;
GRANT ALL ON public.ai_query_logs TO service_role;
GRANT ALL ON public.ai_pending_actions TO service_role;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_rrf(
  query_text text,
  query_embedding vector(1536),
  match_count int,
  p_tenant_id uuid,
  rrf_k int DEFAULT 60
)
RETURNS TABLE (
  id uuid,
  chunk_text text,
  score float
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  vector_results jsonb;
  keyword_results jsonb;
BEGIN
  WITH vector_matches AS (
    SELECT kc.id, ROW_NUMBER() OVER (ORDER BY (1 - (kc.embedding <=> query_embedding)) DESC) AS rank
    FROM public.ai_knowledge_chunks kc
    WHERE (kc.tenant_id = p_tenant_id OR kc.is_global = true)
      AND kc.embedding IS NOT NULL
    LIMIT match_count * 2
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'rank', rank)), '[]'::jsonb) INTO vector_results
  FROM vector_matches;

  WITH keyword_matches AS (
    SELECT kc.id, ROW_NUMBER() OVER (ORDER BY ts_rank(kc.search_vector, plainto_tsquery('english', query_text)) DESC) AS rank
    FROM public.ai_knowledge_chunks kc
    WHERE (kc.tenant_id = p_tenant_id OR kc.is_global = true)
      AND kc.search_vector @@ plainto_tsquery('english', query_text)
    LIMIT match_count * 2
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'rank', rank)), '[]'::jsonb) INTO keyword_results
  FROM keyword_matches;

  RETURN QUERY
  WITH all_ids AS (
    SELECT (j->>'id')::uuid AS id, (j->>'rank')::int AS rank
    FROM jsonb_array_elements(vector_results) AS j
    UNION ALL
    SELECT (j->>'id')::uuid AS id, (j->>'rank')::int AS rank
    FROM jsonb_array_elements(keyword_results) AS j
  ),
  rrf_scores AS (
    SELECT aid.id, SUM(1.0 / (rrf_k + aid.rank)) AS rrf_score
    FROM all_ids aid
    GROUP BY aid.id
  )
  SELECT kc.id, kc.chunk_text, r.rrf_score AS score
  FROM rrf_scores r
  JOIN public.ai_knowledge_chunks kc ON kc.id = r.id
  ORDER BY r.rrf_score DESC
  LIMIT match_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_ai_knowledge_rrf(text, vector, int, uuid, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_rrf(text, vector, int, uuid, int) TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('clean-ai-pending-actions');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'clean-ai-pending-actions',
      '0 * * * *',
      $$ DELETE FROM public.ai_pending_actions WHERE expires_at < now(); $$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed – expired pending actions will not be automatically cleaned.';
  END IF;
END $do$;

COMMIT;
