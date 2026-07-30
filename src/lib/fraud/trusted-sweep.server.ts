// Trusted-status automation. A company with sustained paid activity is no
// longer a trial-abuse concern, so it is promoted to verification_status
// trusted and thereafter skips risk checks. Config-driven (fraud_settings:
// trusted_min_paid_invoices, trusted_min_active_days).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadFraudSettings } from "./fraud-config.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export interface TrustedSweepResult {
  promoted: number;
}

export async function runTrustedPromotionSweep(): Promise<TrustedSweepResult> {
  const cfg = await loadFraudSettings();
  let promoted = 0;
  try {
    const { data: cos } = await sb
      .from("companies")
      .select("id, created_at, verification_status")
      .eq("subscription_status", "active");
    for (const c of (cos ?? []) as Array<Record<string, unknown>>) {
      const vs = c.verification_status as string | null;
      if (vs === "trusted" || vs === "blocked") continue;
      const activeDays = (Date.now() - new Date(c.created_at as string).getTime()) / 86400000;
      if (activeDays < cfg.trustedMinActiveDays) continue;
      const { count } = await sb
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", c.id as string)
        .eq("status", "paid");
      if ((count ?? 0) < cfg.trustedMinPaidInvoices) continue;
      await sb.from("companies").update({ verification_status: "trusted" }).eq("id", c.id as string);
      promoted += 1;
    }
  } catch {
    // tolerant
  }
  return { promoted };
}
