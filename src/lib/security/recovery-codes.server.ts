// One-time MFA recovery codes for super admins. Plaintext is shown once at
// generation; only SHA-256 hashes are stored. Using a code marks it consumed.
import crypto from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

function genCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += alphabet[bytes[i] % alphabet.length];
  return s.slice(0, 5) + "-" + s.slice(5);
}

// Regenerate: invalidates any previous codes for this user, returns 10 new ones.
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  await sb.from("super_admin_recovery_codes").delete().eq("user_id", userId);
  const codes: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  for (let i = 0; i < 10; i++) {
    const c = genCode();
    codes.push(c);
    rows.push({ user_id: userId, code_hash: hashCode(c) });
  }
  await sb.from("super_admin_recovery_codes").insert(rows as never);
  return codes;
}

export async function verifyAndConsumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const { data } = await sb
    .from("super_admin_recovery_codes")
    .select("id")
    .eq("user_id", userId)
    .eq("code_hash", hashCode(code))
    .is("used_at", null)
    .maybeSingle();
  if (!data?.id) return false;
  await sb
    .from("super_admin_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id);
  return true;
}

export async function countRemainingRecoveryCodes(userId: string): Promise<number> {
  const { count } = await sb
    .from("super_admin_recovery_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("used_at", null);
  return count ?? 0;
}
