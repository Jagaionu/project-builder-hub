/**
 * Ingest markdown SOPs into ai_knowledge_chunks.
 *
 * Usage: npm run ingest:knowledge
 * Requires: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

// Local recursive character splitter (replaces @langchain/textsplitters, which
// dragged in vulnerable langsmith/uuid transitively — see npm audit). Tries the
// most semantic separator first and recurses down to a hard char cap.
function splitText(text: string, size: number, overlap: number, seps: string[]): string[] {
  const t = text.trim();
  if (t.length <= size) return t ? [t] : [];
  const sep = seps.find((s) => s && t.includes(s));
  const parts = sep
    ? t.split(sep).map((p, i, a) => (i < a.length - 1 ? p + sep : p))
    : Array.from(t);
  const rest = sep ? seps.slice(seps.indexOf(sep) + 1) : [];
  const chunks: string[] = [];
  let cur = "";
  for (const part of parts) {
    if (part.length > size) {
      if (cur.trim()) {
        chunks.push(cur.trim());
        cur = "";
      }
      chunks.push(...splitText(part, size, overlap, rest));
    } else if ((cur + part).length > size) {
      if (cur.trim()) chunks.push(cur.trim());
      cur = (overlap > 0 && chunks.length ? chunks[chunks.length - 1].slice(-overlap) : "") + part;
    } else {
      cur += part;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 100;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error(
    "::error::Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (empty secret?)",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const SEPARATORS = ["\n## ", "\n### ", "\n\n", "\n", " "];

async function embed(text: string): Promise<number[]> {
  const resp = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return resp.data[0].embedding;
}

async function ingestMarkdownFile(
  filePath: string,
  sourceType: string,
  isGlobal = true,
  tenantId?: string,
) {
  const absPath = path.resolve(filePath);
  const content = await fs.readFile(absPath, "utf-8");
  const chunks = splitText(content, CHUNK_SIZE, CHUNK_OVERLAP, SEPARATORS);

  await supabase.from("ai_knowledge_chunks").delete().eq("source_path", absPath);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await embed(chunk);
    const { error } = await supabase.from("ai_knowledge_chunks").insert({
      tenant_id: tenantId ?? null,
      chunk_text: chunk,
      // pgvector expects the vector as a "[0.1,0.2,...]" string, not a JS array.
      embedding: JSON.stringify(embedding),
      source_type: sourceType,
      source_path: absPath,
      metadata: { chunk_index: i, total_chunks: chunks.length },
      is_global: isGlobal,
    });
    if (error) throw new Error(`Insert failed for ${absPath} chunk ${i}: ${error.message}`);
  }
  console.log(`Ingested ${absPath} (${chunks.length} chunks)`);
}

async function collectMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collectMarkdown(full)));
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

async function preflight() {
  // 1) OpenAI key works?
  try {
    await embed("preflight check");
    console.log("Preflight: OpenAI embeddings OK");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new Error(`OpenAI check failed (is OPENAI_API_KEY valid?): ${m}`);
  }
  // 2) Supabase service role can read the table?
  const { error } = await supabase.from("ai_knowledge_chunks").select("id").limit(1);
  if (error) {
    throw new Error(
      `Supabase check failed (is SUPABASE_SERVICE_ROLE_KEY the service_role key & SUPABASE_URL correct?): ${error.message}`,
    );
  }
  console.log("Preflight: Supabase connection OK");
}

async function main() {
  await preflight();

  // Knowledge base lives in docs/kb (recursively). Falls back to legacy docs/sop.
  let baseDir = path.resolve("./docs/kb");
  try {
    await fs.access(baseDir);
  } catch {
    baseDir = path.resolve("./docs/sop");
  }

  const mdFiles = await collectMarkdown(baseDir).catch(() => [] as string[]);
  if (mdFiles.length === 0) {
    console.warn(`No .md files found under ${baseDir}`);
    return;
  }

  console.log(`Ingesting ${mdFiles.length} file(s) from ${baseDir}`);
  for (const file of mdFiles) {
    await ingestMarkdownFile(file, "sop", true);
  }
  console.log("Done.");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  // Surface the real reason as a GitHub Actions annotation (visible without
  // expanding the step log).
  console.error(`::error::Ingest failed: ${msg}`);
  console.error(err);
  process.exit(1);
});
