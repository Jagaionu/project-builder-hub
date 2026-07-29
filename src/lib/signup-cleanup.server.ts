// Scheduled cleanup for self-serve signups (run via pg_cron like the other crons):
//  1. Delete accounts whose email was never confirmed within 24 hours.
//  2. Delete abandoned trials: companies older than 21 days that never activated
//     (no paid invoice, still trial / suspended / cancelled).
// Both tear down the company (cascades tenant data) and its auth users.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

const DAY_MS = 24 * 60 * 60 * 1000;

async function hardDeleteCompany(companyId: string): Promise<void> {
  const { data: members } = await sb
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId);
  const userIds: string[] = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  if (userIds.length > 0) {
    await sb.from("admin_credentials").delete().in("user_id", userIds).then(
      () => {},
      () => {},
    );
  }
  await sb.from("companies").delete().eq("id", companyId);
  for (const uid of userIds) {
    await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => {});
  }
}

export interface SignupCleanupResult {
  unconfirmedDeleted: number;
  abandonedDeleted: number;
}

export async function runSignupCleanup(): Promise<SignupCleanupResult> {
  const now = Date.now();
  let unconfirmedDeleted = 0;
  let abandonedDeleted = 0;

  // 1. Unconfirmed accounts older than 24 hours.
  const cutoff24 = now - DAY_MS;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      const confirmed = (u as { email_confirmed_at?: string | null }).email_confirmed_at;
      const createdAt = new Date(u.created_at ?? 0).getTime();
      if (confirmed || createdAt >= cutoff24) continue;
      const { data: mem } = await sb
        .from("company_members")
        .select("company_id")
        .eq("user_id", u.id)
        .maybeSingle();
      const companyId = (mem as { company_id?: string } | null)?.company_id;
      if (companyId) await hardDeleteCompany(companyId);
      else await supabaseAdmin.auth.admin.deleteUser(u.id).catch(() => {});
      unconfirmedDeleted += 1;
    }
    if (data.users.length < 200) break;
  }

  // 2. Abandoned trials older than 21 days that never activated.
  const cutoff21 = new Date(now - 21 * DAY_MS).toISOString();
  const { data: stale } = await sb
    .from("companies")
    .select("id, subscription_status, created_at")
    .lt("created_at", cutoff21)
    .in("subscription_status", ["trial", "suspended", "cancelled"]);
  for (const c of (stale ?? []) as Array<{ id: string }>) {
    const { data: paid } = await sb
      .from("invoices")
      .select("id")
      .eq("tenant_id", c.id)
      .eq("status", "paid")
      .limit(1)
      .maybeSingle();
    if (paid) continue;
    await hardDeleteCompany(c.id);
    abandonedDeleted += 1;
  }

  return { unconfirmedDeleted, abandonedDeleted };
}
