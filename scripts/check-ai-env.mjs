/**
 * Verify env vars required for the AI bot (never prints secret values).
 */
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const envPath = path.join(root, ".env");

const required = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
];

function strip(v) {
  return (v ?? "").replace(/^["']|["']$/g, "").trim();
}

function jwtRef(token) {
  const t = strip(token);
  if (!t.includes(".")) return null;
  try {
    const payload = JSON.parse(Buffer.from(t.split(".")[1], "base64url"));
    return payload.ref ?? null;
  } catch {
    return null;
  }
}

function jwtRole(token) {
  const t = strip(token);
  if (!t.includes(".")) return null;
  try {
    const payload = JSON.parse(Buffer.from(t.split(".")[1], "base64url"));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

if (!fs.existsSync(envPath)) {
  console.error("Missing .env — run: npm run sync:env");
  process.exit(1);
}

const vars = new Map();
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  vars.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim());
}

const placeholder = (v) => {
  const s = strip(v);
  return !s || s.includes("your-") || s.includes("REPLACE") || s === "sk-your-openai-key";
};

const missing = required.filter((k) => placeholder(vars.get(k)));

if (missing.length) {
  console.error("AI bot cannot run until these .env vars have real values:");
  for (const k of missing) console.error(`  ${k}`);
  process.exit(1);
}

const url = strip(vars.get("SUPABASE_URL"));
const urlRef = (url.match(/https:\/\/([^.]+)\.supabase\.co/) ?? [])[1] ?? null;
const svcRef = jwtRef(vars.get("SUPABASE_SERVICE_ROLE_KEY"));
const svcRole = jwtRole(vars.get("SUPABASE_SERVICE_ROLE_KEY"));
const pubRef = jwtRef(vars.get("VITE_SUPABASE_PUBLISHABLE_KEY"));

if (!urlRef) {
  console.error("SUPABASE_URL is invalid. Expected https://YOUR-PROJECT-REF.supabase.co (no quotes).");
  process.exit(1);
}

if (svcRole !== "service_role") {
  console.error("SUPABASE_SERVICE_ROLE_KEY must be the service_role key, not the anon/publishable key.");
  process.exit(1);
}

if (svcRef && svcRef !== urlRef) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is from a different Supabase project.");
  console.error(`  .env URL project:     ${urlRef}`);
  console.error(`  service_role key ref: ${svcRef}`);
  console.error("Fix: Supabase Dashboard → project", urlRef, "→ Settings → API → service_role → copy again.");
  process.exit(1);
}

if (pubRef && pubRef !== urlRef) {
  console.error("VITE_SUPABASE_PUBLISHABLE_KEY is from a different project than SUPABASE_URL.");
  process.exit(1);
}

const quoted = ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"].filter(
  (k) => /^["']/.test(vars.get(k) ?? ""),
);
if (quoted.length) {
  console.warn("Warning: remove wrapping quotes from:", quoted.join(", "));
}

console.log("AI env OK (6/6 required vars present, Supabase keys match project", urlRef + ").");
