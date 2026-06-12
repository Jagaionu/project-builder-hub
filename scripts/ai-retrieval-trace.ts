/**
 * Phase-1 gate: prove the RAG retrieval path end-to-end BEFORE writing docs.
 *
 * Inserts ONE known global chunk, then for a keyword query and a semantic
 * paraphrase (minimal lexical overlap) it:
 *   - logs the raw cosine similarity (query embedding vs stored embedding)
 *   - calls match_ai_knowledge_rrf and logs the blended RRF scores
 *   - asserts the trace chunk is returned (ideally rank #1)
 * Then it removes the trace chunk.
 *
 * Usage: npm run ai:trace
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY in .env
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const TRACE_PATH = "trace://retrieval-test";
const TRACE_CHUNK =
  "TRACE-FACT: In The Prime Route, a VRID (Vehicle Run ID) is the unique identifier " +
  "for a single planned route. Each VRID has an origin and a destination warehouse, a " +
  "planned start time, and a sequence of stops with planned yard and dock times.";

async function embed(text: string): Promise<number[]> {
  const r = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
  return r.data[0].embedding;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function probe(label: string, query: string, chunkId: string, stored: number[]) {
  const qEmb = await embed(query);
  const sim = cosine(qEmb, stored);
  const { data, error } = await (supabase as any).rpc("match_ai_knowledge_rrf", {
    query_text: query,
    query_embedding: qEmb,
    match_count: 6,
    p_tenant_id: "00000000-0000-0000-0000-000000000000", // any uuid; chunk is_global=true
  });
  console.log("\n-- " + label + " --");
  console.log('  query:          "' + query + '"');
  console.log("  raw cosine sim: " + sim.toFixed(4) + "  (vector leg health)");
  if (error) {
    console.log("  RPC ERROR: " + error.message);
    return false;
  }
  const rows = (data ?? []) as Array<{ id: string; chunk_text: string; score: number }>;
  rows.forEach((r, i) => {
    const mark = r.id === chunkId ? "  <- trace chunk" : "";
    console.log(
      "  #" +
        (i + 1) +
        " rrf=" +
        Number(r.score).toFixed(5) +
        " " +
        r.chunk_text.slice(0, 46) +
        "..." +
        mark,
    );
  });
  const rank = rows.findIndex((r) => r.id === chunkId);
  if (rank === -1) {
    console.log("  RESULT: x NOT retrieved");
    return false;
  }
  console.log("  RESULT: " + (rank === 0 ? "ok #1" : "~ #" + (rank + 1)));
  return true;
}

async function main() {
  await supabase.from("ai_knowledge_chunks").delete().eq("source_path", TRACE_PATH);
  const embedding = await embed(TRACE_CHUNK);
  const { data: ins, error } = await supabase
    .from("ai_knowledge_chunks")
    .insert({
      tenant_id: null,
      chunk_text: TRACE_CHUNK,
      embedding,
      source_type: "sop",
      source_path: TRACE_PATH,
      metadata: { trace: true },
      is_global: true,
    })
    .select("id")
    .single();
  if (error || !ins) {
    console.error("Insert failed:", error?.message);
    process.exit(1);
  }
  const chunkId = (ins as { id: string }).id;
  console.log("Inserted chunk " + chunkId);

  const r1 = await probe(
    "keyword + semantic",
    "What is a VRID and what does it contain?",
    chunkId,
    embedding,
  );
  const r2 = await probe(
    "semantic-only paraphrase",
    "How is a single delivery journey identified in this system?",
    chunkId,
    embedding,
  );

  await supabase.from("ai_knowledge_chunks").delete().eq("source_path", TRACE_PATH);
  const ok = r1 && r2;
  console.log(
    "\n" +
      (ok
        ? "PASS - retrieval path proven (semantic + hybrid both return the chunk)"
        : "FAIL - see scores above"),
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
