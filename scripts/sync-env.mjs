/**
 * Merge .env.example into .env without overwriting existing values.
 * Prefills Supabase URL from supabase/config.toml project_id.
 * Safe to run repeatedly — never prints secret values.
 */
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");
const configPath = path.join(root, "supabase", "config.toml");

function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1));
  }
  return map;
}

function readProjectId() {
  if (!fs.existsSync(configPath)) return null;
  const m = fs.readFileSync(configPath, "utf8").match(/project_id\s*=\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

function stripQuotes(v) {
  return (v ?? "").replace(/^["']|["']$/g, "").trim();
}

function urlProjectRef(url) {
  const ref = (stripQuotes(url).match(/https:\/\/([^.]+)\.supabase\.co/) ?? [])[1];
  return ref ?? null;
}

const projectId = readProjectId();
const supabaseUrl = projectId ? `https://${projectId}.supabase.co` : null;

function isPlaceholder(v) {
  return !v || v.includes("your-") || v.includes("REPLACE") || v === "sk-your-openai-key";
}

const existing = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, "utf8")) : new Map();
const template = fs.existsSync(examplePath) ? parseEnv(fs.readFileSync(examplePath, "utf8")) : new Map();

const merged = new Map(template);

for (const [k, v] of existing) {
  if (!isPlaceholder(v)) {
    merged.set(k, v);
  } else if (!merged.has(k)) {
    merged.set(k, v);
  }
}

if (supabaseUrl && projectId) {
  // config.toml is source of truth for which Supabase project this repo uses
  merged.set("VITE_SUPABASE_URL", supabaseUrl);
  merged.set("SUPABASE_URL", supabaseUrl);
  merged.set("VITE_SUPABASE_PROJECT_ID", projectId);
}

const pub = merged.get("SUPABASE_PUBLISHABLE_KEY");
if (pub && !isPlaceholder(pub) && isPlaceholder(merged.get("VITE_SUPABASE_PUBLISHABLE_KEY"))) {
  merged.set("VITE_SUPABASE_PUBLISHABLE_KEY", pub);
}

const order = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "SUPER_ADMIN_EMAIL",
  "SUPER_ADMIN_PASSWORD",
];

const lines = [
  "# Auto-synced by scripts/sync-env.mjs — secrets stay local (gitignored).",
  "# Fill REPLACE_ME values from Supabase Dashboard > Project Settings > API",
  "",
];

for (const key of order) {
  if (!merged.has(key)) continue;
  lines.push(`${key}=${merged.get(key)}`);
}

for (const [key, val] of merged) {
  if (!order.includes(key)) lines.push(`${key}=${val}`);
}

fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf8");

const required = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
];

const missing = required.filter((k) => isPlaceholder(merged.get(k)));

console.log(`Updated ${envPath}`);
if (missing.length) {
  console.log("\nStill need real values for:");
  for (const k of missing) console.log(`  - ${k}`);
  console.log("\nSupabase: Dashboard > Project Settings > API");
  console.log("OpenAI:   https://platform.openai.com/api-keys");
  process.exitCode = 1;
} else {
  const urlRef = urlProjectRef(merged.get("SUPABASE_URL"));
  const pubRef = jwtRefFromEnv(merged.get("VITE_SUPABASE_PUBLISHABLE_KEY"));
  const svcRef = jwtRefFromEnv(merged.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (urlRef && pubRef && pubRef !== urlRef) {
    console.log(`\nWARNING: publishable key is for project ${pubRef} but URL is ${urlRef}.`);
    console.log(`Copy anon key from https://supabase.com/dashboard/project/${urlRef}/settings/api`);
    process.exitCode = 1;
  } else if (urlRef && svcRef && svcRef !== urlRef) {
    console.log(`\nWARNING: service_role key is for project ${svcRef} but URL is ${urlRef}.`);
    console.log(`Copy service_role from https://supabase.com/dashboard/project/${urlRef}/settings/api`);
    process.exitCode = 1;
  } else {
    console.log(`All required variables are set (project ${urlRef ?? projectId}).`);
  }
}

function jwtRefFromEnv(token) {
  const t = stripQuotes(token);
  if (!t.includes(".")) return null;
  try {
    return JSON.parse(Buffer.from(t.split(".")[1], "base64url")).ref ?? null;
  } catch {
    return null;
  }
}
