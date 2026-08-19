// Super-admin revenue metrics: active subscribers, estimated MRR, and net
// revenue over 30d / 12m / all-time (refunds netted off). Net = ex-VAT, ex-fee.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

async function assertSuperAdmin(userId: string): Promise<void> {
  const { data } = await sb.from("super_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("Forbidden: super admin only");
}

export const getRevenueMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);

    // Active subscribers + estimated MRR (monthly net per active company).
    const { data: active } = await sb
      .from("companies")
      .select("id, plan, config")
      .eq("subscription_status", "active");
    const { data: prices } = await sb
      .from("plan_prices")
      .select("plan, net_amount_minor")
      .eq("currency", "GBP")
      .eq("active", true)
      .eq("interval", "monthly");
    const monthlyByPlan: Record<string, number> = {};
    for (const p of (prices ?? []) as Array<{ plan: string; net_amount_minor: number }>) {
      monthlyByPlan[p.plan] = p.net_amount_minor;
    }
    let mrrMinor = 0;
    for (const c of (active ?? []) as Array<{ plan: string; config: Record<string, unknown> | null }>) {
      const cfg = (c.config ?? {}) as { priceMonthlyMinor?: number | null };
      const override = cfg.priceMonthlyMinor;
      const net = typeof override === "number" && override >= 0 ? override : (monthlyByPlan[c.plan] ?? 0);
      mrrMinor += net;
    }
    const activeSubscribers = (active ?? []).length;

    // Net revenue windows from settled invoices (refunds netted off).
    const { data: invs } = await sb
      .from("invoices")
      .select("net_amount_minor, status, created_at, paid_at")
      .in("status", ["paid", "refunded"])
      .limit(20000);
    const now = Date.now();
    const d30 = now - 30 * 86400000;
    const d365 = now - 365 * 86400000;
    let r30 = 0;
    let r365 = 0;
    let rAll = 0;
    for (const iv of (invs ?? []) as Array<{ net_amount_minor: number | null; status: string; created_at: string; paid_at: string | null }>) {
      const net = Number(iv.net_amount_minor ?? 0);
      const signed = iv.status === "refunded" ? -Math.abs(net) : net;
      const t = new Date(iv.paid_at ?? iv.created_at).getTime();
      rAll += signed;
      if (t >= d365) r365 += signed;
      if (t >= d30) r30 += signed;
    }

    return {
      activeSubscribers,
      mrrMinor,
      revenue30dMinor: r30,
      revenue12mMinor: r365,
      revenueAllMinor: rAll,
    };
  });
