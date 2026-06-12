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
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY");
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
      embedding,
      source_type: sourceType,
      source_path: absPath,
      metadata: { chunk_index: i, total_chunks: chunks.length },
      is_global: isGlobal,
    });
    if (error) throw error;
  }
  console.log(`Ingested ${absPath} (${chunks.length} chunks)`);
}

async function main() {
  const sopDir = path.resolve("./docs/sop");
  try {
    await fs.access(sopDir);
  } catch {
    await fs.mkdir(sopDir, { recursive: true });
    await fs.writeFile(
      path.join(sopDir, "overview.md"),
      "# Logistics Platform Overview\n\nSee dispatch board for daily operations.",
    );
    console.log("Created placeholder docs/sop/overview.md");
  }

  const files = await fs.readdir(sopDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) {
    console.warn("No .md files in docs/sop/");
    return;
  }

  for (const file of mdFiles) {
    await ingestMarkdownFile(path.join(sopDir, file), "sop", true);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
