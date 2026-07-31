// App-level login rate limiting (defence in depth over Supabase auth limits).
// Public server fns (login is pre-auth). Window/threshold reuse fraud_settings
// so they are tunable without a deploy. Tolerant if login_attempts is missing.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadFraudSettings } from "@/lib/fraud/fraud-config.server";
import { sanitizeIdent } from "@/lib/fraud/rate-limit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

function clientIp(): string | null {
  try {
    const h = getRequest()?.headers;
    if (!h) return null;
    return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

export const preLoginCheck = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ email: z.string().trim().email().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const cfg = await loadFraudSettings();
    const ip = clientIp();
    const email = (data.email ?? "").toLowerCase();
    const since = new Date(Date.now() - cfg.rateLimitWindowMinutes * 60 * 1000).toISOString();
    const ors: string[] = [];
    if (ip) ors.push("ip.eq." + sanitizeIdent(ip));
    if (email) ors.push("email.eq." + email);
    if (ors.length === 0) return { ok: true };
    try {
      const { count } = await sb
        .from("login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("outcome", "failed")
        .gte("created_at", since)
        .or(ors.join(","));
      if ((count ?? 0) >= cfg.rateLimitMaxAttempts) {
        throw new Error("Too many failed sign-in attempts. Please wait a few minutes and try again.");
      }
    } catch (e) {
      if (e instanceof Error && e.message.indexOf("Too many") === 0) throw e;
      // table missing / query error -> do not block sign-in
    }
    return { ok: true };
  });

export const noteFailedLogin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ email: z.string().trim().email().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    try {
      await sb.from("login_attempts").insert({
        email: (data.email ?? "").toLowerCase() || null,
        ip: clientIp(),
        outcome: "failed",
      } as never);
    } catch {
      // best effort
    }
    return { ok: true };
  });
