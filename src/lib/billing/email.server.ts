// Transactional email sender. Reads the active provider config (set by a super
// admin from the dashboard) and dispatches via the provider's HTTP API.
// Supports Resend and Postmark over HTTPS; SES is stubbed for completeness.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId: string | null;
  error?: string;
}

interface EmailConfig {
  provider: "resend" | "postmark" | "ses";
  api_key: string | null;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
}

async function loadConfig(): Promise<EmailConfig | null> {
  const { data } = await sb
    .from("email_provider_config")
    .select("provider, api_key, from_email, from_name, reply_to")
    .eq("active", true)
    .maybeSingle();
  return (data as EmailConfig | null) ?? null;
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const cfg = await loadConfig();
  if (!cfg)
    return { ok: false, providerMessageId: null, error: "No active email provider configured" };
  if (!cfg.api_key)
    return { ok: false, providerMessageId: null, error: "Email provider API key not set" };

  const from = cfg.from_name ? `${cfg.from_name} <${cfg.from_email}>` : cfg.from_email;

  try {
    if (cfg.provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.api_key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          ...(cfg.reply_to ? { reply_to: cfg.reply_to } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok)
        return { ok: false, providerMessageId: null, error: body.message ?? `HTTP ${res.status}` };
      return { ok: true, providerMessageId: body.id ?? null };
    }

    if (cfg.provider === "postmark") {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": cfg.api_key,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          From: from,
          To: msg.to,
          Subject: msg.subject,
          TextBody: msg.text,
          HtmlBody: msg.html,
          ...(cfg.reply_to ? { ReplyTo: cfg.reply_to } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { MessageID?: string; Message?: string };
      if (!res.ok)
        return { ok: false, providerMessageId: null, error: body.Message ?? `HTTP ${res.status}` };
      return { ok: true, providerMessageId: body.MessageID ?? null };
    }

    // SES via SDK is out of scope here; surface a clear error so it isn't
    // silently treated as sent.
    return { ok: false, providerMessageId: null, error: "SES sending not yet implemented" };
  } catch (err) {
    return {
      ok: false,
      providerMessageId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
