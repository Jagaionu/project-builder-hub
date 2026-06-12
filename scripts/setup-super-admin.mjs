/**
 * Bootstrap / recover a super admin account.
 *
 * Idempotent: safe to run repeatedly. Creates the auth user if missing,
 * resets its password + confirms its email if it already exists, and
 * guarantees a matching row in public.super_admins.
 *
 * This is a RECOVERY tool — it intentionally runs outside the app using the
 * service-role key, because the in-app provisioning flow requires you to
 * already be signed in as a super admin (the very thing that breaks when you
 * get locked out).
 *
 * Required env vars (read from .env via `node --env-file=.env`):
 *   SUPABASE_URL                - e.g. https://xxxx.supabase.co  (already in .env)
 *   SUPABASE_SERVICE_ROLE_KEY   - Dashboard > Project Settings > API > service_role
 *                                 (SECRET — never commit, never ship to the client)
 *
 * Credentials (CLI args take precedence, then env vars):
 *   SUPER_ADMIN_EMAIL / --email=...
 *   SUPER_ADMIN_PASSWORD / --password=...
 *
 * Usage:
 *   npm run setup:super-admin -- --email=you@example.com --password='Strong-Pass-123'
 * or:
 *   node --env-file=.env scripts/setup-super-admin.mjs --email=... --password=...
 */
import { createClient } from "@supabase/supabase-js";

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = (argValue("email") ?? process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = argValue("password") ?? process.env.SUPER_ADMIN_PASSWORD ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  const missing = [
    !SUPABASE_URL && "SUPABASE_URL",
    !SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  fail(
    `Missing env var(s): ${missing.join(", ")}.\n` +
      `  - SUPABASE_URL should already be in .env.\n` +
      `  - SUPABASE_SERVICE_ROLE_KEY comes from Dashboard > Project Settings > API > service_role.\n` +
      `  Add it to .env (it is a secret) or pass it inline, then re-run.`,
  );
}

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  fail("Provide a valid email via --email=... or SUPER_ADMIN_EMAIL.");
}
if (password.length < 8) {
  fail("Provide a password (min 8 chars) via --password=... or SUPER_ADMIN_PASSWORD.");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserIdByEmail(targetEmail) {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === targetEmail);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
}

async function main() {
  console.log(`\n→ Ensuring super admin for ${email} on ${SUPABASE_URL}`);

  let userId = null;

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created?.user) {
    userId = created.user.id;
    console.log("✓ Created new auth user (email auto-confirmed).");
  } else if (createErr) {
    const msg = (createErr.message ?? "").toLowerCase();
    const isDuplicate =
      msg.includes("already been registered") ||
      msg.includes("already registered") ||
      msg.includes("already exists") ||
      createErr.code === "email_exists";
    if (!isDuplicate) throw new Error(`createUser failed: ${createErr.message}`);

    userId = await findUserIdByEmail(email);
    if (!userId) throw new Error("User reported as existing but could not be found by email.");

    const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updateErr) throw new Error(`updateUserById failed: ${updateErr.message}`);
    console.log("✓ Existing auth user found — password reset and email confirmed.");
  } else {
    throw new Error("createUser returned neither a user nor an error.");
  }

  const { error: saErr } = await supabase
    .from("super_admins")
    .upsert({ user_id: userId }, { onConflict: "user_id" });
  if (saErr) throw new Error(`Failed to upsert super_admins row: ${saErr.message}`);
  console.log("✓ super_admins row ensured.");

  console.log(`\n✔ Done. Sign in at /login with:\n   email:    ${email}\n   user id:  ${userId}\n`);
}

main().catch((err) => fail(err.message ?? String(err)));
