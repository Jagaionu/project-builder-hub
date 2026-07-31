// Immutable super-admin audit log writer. Captures actor, action, IP and UA.
// Best-effort: never throws into the calling action.
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export type AuditCategory = "auth" | "security" | "administration" | "billing" | "data";

export interface AuditEntry {
  actorUserId?: string | null;
  actorEmail?: string | null;
  category: AuditCategory;
  action: string;
  detail?: Record<string, unknown>;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const req = getRequest();
    const h = req?.headers;
    if (h) {
      ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
      userAgent = h.get("user-agent");
    }
  } catch {
    // headers unavailable
  }
  try {
    await sb.from("super_admin_audit").insert({
      actor_user_id: entry.actorUserId ?? null,
      actor_email: entry.actorEmail ?? null,
      category: entry.category,
      action: entry.action,
      detail: entry.detail ?? {},
      ip,
      user_agent: userAgent,
    } as never);
  } catch {
    // audit must never block the action
  }
}
