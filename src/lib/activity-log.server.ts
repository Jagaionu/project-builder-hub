import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as unknown as { from: (t: string) => any };

// Server-side audit write for server functions / edge contexts. Tenant + actor
// are passed explicitly (no request-scoped session helper here). Best-effort.
export async function logActivityServer(args: {
  tenantId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  entityRef?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await sb.from("activity_log").insert({
      tenant_id: args.tenantId,
      actor_user_id: args.actorUserId ?? null,
      actor_email: args.actorEmail ?? null,
      actor_name: args.actorName ?? null,
      action: args.action,
      entity_type: args.entityType ?? null,
      entity_id: args.entityId ?? null,
      entity_ref: args.entityRef ?? null,
      metadata: args.metadata ?? {},
    });
  } catch {
    // best-effort.
  }
}
