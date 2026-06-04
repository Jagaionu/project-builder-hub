import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";

// activity_log isn't in the generated types — access loosely.
const sb = supabase as unknown as { from: (t: string) => any };

// Cache the current actor (id/email/name) for the session — cleared on reload,
// which also happens on profile switch, so it stays correct.
let cachedActor: { userId: string | null; email: string | null; name: string | null } | null = null;

async function actor() {
  if (cachedActor) return cachedActor;
  const { data: { user } } = await supabase.auth.getUser();
  let name: string | null = null;
  if (user) {
    const { data } = await sb
      .from("company_members")
      .select("name")
      .eq("user_id", user.id)
      .maybeSingle();
    name = (data as { name?: string | null } | null)?.name ?? null;
  }
  cachedActor = { userId: user?.id ?? null, email: user?.email ?? null, name };
  return cachedActor;
}

export type ActivityAction =
  | "lane.create"
  | "lane.upload"
  | "plan.run"
  | "job.cancel"
  | "job.assign"
  | "job.delete"
  | "import.delete"
  | "driver.create"
  | "driver.edit"
  | (string & {});

type Opts = {
  entityType?: string;
  entityId?: string | null;
  entityRef?: string | null;
  metadata?: Record<string, unknown>;
};

// Best-effort, fire-and-forget audit write. NEVER throws / blocks the action.
export async function logActivity(action: ActivityAction, opts: Opts = {}): Promise<void> {
  try {
    const a = await actor();
    const tenant_id = await getTenantId();
    if (!tenant_id) return;
    await sb.from("activity_log").insert({
      tenant_id,
      actor_user_id: a.userId,
      actor_email: a.email,
      actor_name: a.name,
      action,
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId ?? null,
      entity_ref: opts.entityRef ?? null,
      metadata: opts.metadata ?? {},
    });
  } catch {
    // best-effort: audit failures must never break the underlying action.
  }
}
