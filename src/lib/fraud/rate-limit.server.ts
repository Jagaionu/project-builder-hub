// Signup event recording + rate limiting. Runs BEFORE Companies House / scoring
// so a burst of attempts from one IP or device is throttled cheaply and the CH
// API is protected. Tolerant if signup_events does not exist yet.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { FraudSettings } from "./fraud-config";
import { rateWindowStartMs, exceedsRateLimit, sanitizeIdent } from "./rate-limit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export interface SignupEventInput {
  email?: string | null;
  emailDomain?: string | null;
  companyNumber?: string | null;
  ip?: string | null;
  deviceId?: string | null;
  userAgent?: string | null;
  fingerprint?: string | null;
  outcome: string;
}

export async function recordSignupEvent(e: SignupEventInput): Promise<void> {
  try {
    await sb.from("signup_events").insert({
      email: e.email ?? null,
      email_domain: e.emailDomain ?? null,
      company_number: e.companyNumber ?? null,
      ip: e.ip ?? null,
      device_id: e.deviceId ?? null,
      user_agent: e.userAgent ?? null,
      fingerprint: e.fingerprint ?? null,
      outcome: e.outcome,
    } as never);
  } catch {
    // tolerant pre-migration
  }
}

export async function countRecentAttempts(
  ident: { ip?: string | null; deviceId?: string | null },
  cfg: FraudSettings,
  nowMs: number = Date.now(),
): Promise<number> {
  const since = new Date(rateWindowStartMs(nowMs, cfg)).toISOString();
  const ors: string[] = [];
  if (ident.ip) ors.push("ip.eq." + sanitizeIdent(ident.ip));
  if (ident.deviceId) ors.push("device_id.eq." + sanitizeIdent(ident.deviceId));
  if (ors.length === 0) return 0;
  try {
    const { count } = await sb
      .from("signup_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .or(ors.join(","));
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function checkRateLimit(
  ident: { ip?: string | null; deviceId?: string | null },
  cfg: FraudSettings,
  nowMs: number = Date.now(),
): Promise<{ limited: boolean; attempts: number }> {
  const attempts = await countRecentAttempts(ident, cfg, nowMs);
  return { limited: exceedsRateLimit(attempts, cfg), attempts };
}
