-- Fix: ambiguous "id" column in match_ai_knowledge_rrf when called via RPC.
-- The function's RETURNS TABLE(id uuid, ...) creates an implicit PL/pgSQL variable
-- that shadows CTE column names. Also switched from LANGUAGE plpgsql to sql
-- to avoid PostgREST RETURN QUERY incompatibility.
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
  score double precision
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH vector_matches AS (
    SELECT kc.id, ROW_NUMBER() OVER (ORDER BY (1 - (kc.embedding <=> query_embedding)) DESC) AS rank
    FROM public.ai_knowledge_chunks kc
    WHERE (kc.tenant_id = p_tenant_id OR kc.is_global = true)
      AND kc.embedding IS NOT NULL
    LIMIT match_count * 2
  ),
  keyword_matches AS (
    SELECT kc.id, ROW_NUMBER() OVER (ORDER BY ts_rank(kc.search_vector, plainto_tsquery('english', query_text)) DESC) AS rank
    FROM public.ai_knowledge_chunks kc
    WHERE (kc.tenant_id = p_tenant_id OR kc.is_global = true)
      AND kc.search_vector @@ plainto_tsquery('english', query_text)
    LIMIT match_count * 2
  ),
  all_ids AS (
    SELECT vm.id, vm.rank FROM vector_matches vm
    UNION ALL
    SELECT km.id, km.rank FROM keyword_matches km
  ),
  rrf_scores AS (
    SELECT all_ids.id, SUM(1.0 / (rrf_k + all_ids.rank)) AS rrf_score
    FROM all_ids
    GROUP BY all_ids.id
  )
  SELECT kc.id, kc.chunk_text, r.rrf_score AS score
  FROM rrf_scores r
  JOIN public.ai_knowledge_chunks kc ON kc.id = r.id
  ORDER BY r.rrf_score DESC
  LIMIT match_count;
$$;
