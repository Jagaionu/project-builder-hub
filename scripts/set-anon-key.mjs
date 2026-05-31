/**
 * Update anon/publishable keys in .env (run locally — never paste keys in chat).
 *
 * Usage:
 *   npm run set:anon-key
 *   (paste key when prompted, then Enter)
 */
import fs from "fs";
import readline from "readline";
import path from "path";

const envPath = path.resolve(import.meta.dirname, "..", ".env");

function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const map = new Map();
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    map.set(t.slice(0, eq).trim(), t.slice(eq + 1));
  }
  return { lines, map };
}

function strip(v) {
  return (v ?? "").replace(/^["']|["']$/g, "").trim();
}

function jwtRef(token) {
  const t = strip(token);
  if (!t.includes(".")) return null;
  try {
    return JSON.parse(Buffer.from(t.split(".")[1], "base64url")).ref ?? null;
  } catch {
    return null;
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Paste Legacy anon (public) key from ftvzuqmgshbkvjvfzwzv, then Enter:\n", (raw) => {
  rl.close();
  const key = strip(raw);
  if (!key.startsWith("eyJ")) {
    console.error("Expected a Legacy JWT anon key starting with eyJ");
    process.exit(1);
  }

  const ref = jwtRef(key);
  if (ref !== "ftvzuqmgshbkvjvfzwzv") {
    console.error(`Key is for project ${ref}, expected ftvzuqmgshbkvjvfzwzv`);
    process.exit(1);
  }

  if (!fs.existsSync(envPath)) {
    console.error("Missing .env — run npm run sync:env first");
    process.exit(1);
  }

  const text = fs.readFileSync(envPath, "utf8");
  const { lines } = parseEnv(text);
  const out = [];
  let replaced = 0;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("VITE_SUPABASE_PUBLISHABLE_KEY=")) {
      out.push(`VITE_SUPABASE_PUBLISHABLE_KEY=${key}`);
      replaced++;
    } else if (line.startsWith("SUPABASE_PUBLISHABLE_KEY=")) {
      out.push(`SUPABASE_PUBLISHABLE_KEY=${key}`);
      replaced++;
    } else {
      out.push(line);
    }
  }

  if (replaced === 0) {
    out.push(`VITE_SUPABASE_PUBLISHABLE_KEY=${key}`);
    out.push(`SUPABASE_PUBLISHABLE_KEY=${key}`);
  }

  fs.writeFileSync(envPath, out.join("\n").replace(/\n+$/, "") + "\n", "utf8");
  console.log("Updated .env publishable keys. Run: npm run check:env");
});
