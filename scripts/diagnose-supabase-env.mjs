/**
 * Diagnose Supabase env key mismatches (never prints full keys).
 * Usage: node --env-file=.env scripts/diagnose-supabase-env.mjs
 */
function strip(v) {
  return (v ?? "").replace(/^["']|["']$/g, "").trim();
}

function decodeJwt(token) {
  const t = strip(token);
  if (!t.includes(".")) return { error: "not a JWT" };
  try {
    return JSON.parse(Buffer.from(t.split(".")[1], "base64url"));
  } catch (e) {
    return { error: String(e) };
  }
}

const url = strip(process.env.SUPABASE_URL);
const urlRef = (url.match(/https:\/\/([^.]+)\.supabase\.co/) ?? [])[1] ?? null;

const pub = decodeJwt(
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
const svc = decodeJwt(process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("SUPABASE_URL ref:", urlRef ?? "INVALID (check URL, remove quotes)");
console.log("Publishable key role:", pub.role ?? pub.error, "| ref:", pub.ref ?? "-");
console.log("Service role key role:", svc.role ?? svc.error, "| ref:", svc.ref ?? "-");
console.log("");
console.log("Checks:");
console.log("  URL matches publishable ref:", urlRef === pub.ref ? "YES" : "NO");
console.log("  URL matches service role ref:", urlRef === svc.ref ? "YES" : "NO");
console.log(
  "  Service key is service_role:",
  svc.role === "service_role" ? "YES" : "NO — use service_role key, not anon",
);
console.log("  Publishable is anon:", pub.role === "anon" ? "YES" : "NO");

const urlHasQuotes = /^["']/.test(process.env.SUPABASE_URL ?? "");
const pubHasQuotes = /^["']/.test(
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
);
if (urlHasQuotes || pubHasQuotes) {
  console.log("");
  console.log("WARNING: Remove wrapping quotes from SUPABASE_URL and publishable keys in .env");
}
