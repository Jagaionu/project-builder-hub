// Billing orchestrator (server). The single place that turns state-machine
// decisions into database side effects: subscription status, plan
// entitlements, invoices, the append-only payment_events log, and dunning.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { NormalisedEvent } from "./provider";
import {
  reduceBilling,
  type BillingAction,
  type BillingEvent,
  type BillingState,
} from "./state-machine";
import { loadPlanEntitlements } from "./plan-entitlements.server";
import { sendDunningStep } from "./dunning.server";
import type { PlanTier } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export async function recordPaymentEvent(args: {
  tenantId: string | null;
  invoiceId?: string | null;
  provider?: string | null;
  eventType: string;
  actor?: string;
  data?: unknown;
}): Promise<void> {
  await sb.from("payment_events").insert({
    tenant_id: args.tenantId,
    invoice_id: args.invoiceId ?? null,
    provider: args.provider ?? null,
    event_type: args.eventType,
    actor: args.actor ?? "system",
    data: args.data ?? null,
  });
}

async function loadState(companyId: string): Promise<BillingState> {
  const { data } = await sb
    .from("companies")
    .select("subscription_status, subscription_ends_at")
    .eq("id", companyId)
    .maybeSingle();
  return {
    subscriptionStatus: (data?.subscription_status ??
      "trial") as BillingState["subscriptionStatus"],
    subscriptionEndsAt: data?.subscription_ends_at ?? null,
  };
}

async function applyPlanEntitlements(companyId: string, plan: PlanTier): Promise<void> {
  const e = await loadPlanEntitlements(plan);
  const { data } = await sb.from("companies").select("config").eq("id", companyId).maybeSingle();
  const config = { ...(data?.config ?? {}) };
  config.modules = e.modules;
  config.maxDrivers = e.maxDrivers;
  config.maxWarehouses = e.maxWarehouses;
  config.customBranding = e.customBranding;
  await sb.from("companies").update({ plan, config }).eq("id", companyId);
}

async function applyAction(
  companyId: string,
  action: BillingAction,
  ctx: { invoiceId?: string | null; provider?: string | null },
): Promise<void> {
  switch (action.type) {
    case "activate":
      await sb.from("companies").update({ subscription_status: "active" }).eq("id", companyId);
      break;
    case "suspend":
      await sb.from("companies").update({ subscription_status: "suspended" }).eq("id", companyId);
      break;
    case "schedule_cancellation":
      await sb.from("companies").update({ subscription_status: "cancelled" }).eq("id", companyId);
      break;
    case "apply_plan_entitlements":
      await applyPlanEntitlements(companyId, action.plan);
      break;
    case "send_dunning":
      await sendDunningStep({ companyId, invoiceId: ctx.invoiceId ?? null, step: action.step });
      break;
  }
}

/** Apply a billing event to a company: reduce -> persist status + run actions. */
export async function processBillingEvent(
  companyId: string,
  event: BillingEvent,
  ctx: { invoiceId?: string | null; provider?: string | null } = {},
): Promise<void> {
  const state = await loadState(companyId);
  const transition = reduceBilling(state, event);

  // Persist status + period end first so RLS gating is immediate.
  await sb
    .from("companies")
    .update({
      subscription_status: transition.nextStatus,
      subscription_ends_at: transition.subscriptionEndsAt,
    })
    .eq("id", companyId);

  for (const action of transition.actions) {
    await applyAction(companyId, action, ctx);
  }

  await recordPaymentEvent({
    tenantId: companyId,
    invoiceId: ctx.invoiceId ?? null,
    provider: ctx.provider ?? null,
    eventType: `billing.${event.kind}`,
    data: { transition },
  });
}

/** Number of consecutive payment failures since the last success (for dunning). */
async function consecutiveFailures(companyId: string): Promise<number> {
  const { data } = await sb
    .from("payment_events")
    .select("event_type, created_at")
    .eq("tenant_id", companyId)
    .order("created_at", { ascending: false })
    .limit(20);
  let count = 0;
  for (const row of data ?? []) {
    if (row.event_type === "billing.payment_failed") count += 1;
    else if (
      row.event_type === "billing.payment_succeeded" ||
      row.event_type === "billing.bank_transfer_reconciled"
    )
      break;
  }
  return count;
}

/** Resolve a company from a provider's customer reference. */
async function companyByCustomerRef(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const { data } = await sb
    .from("companies")
    .select("id")
    .eq("billing_customer_ref", ref)
    .maybeSingle();
  return data?.id ?? null;
}

/** Process a normalised provider webhook event end-to-end. */
export async function handleNormalisedEvent(ev: NormalisedEvent): Promise<void> {
  const companyId = await companyByCustomerRef(ev.companyRef);
  if (!companyId) {
    await recordPaymentEvent({
      tenantId: null,
      provider: ev.provider,
      eventType: `webhook.unmatched.${ev.type}`,
      actor: "webhook",
      data: { companyRef: ev.companyRef },
    });
    return;
  }

  // Default period: extend one month from now on success.
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  switch (ev.type) {
    case "payment_succeeded":
    case "mandate_active":
      await processBillingEvent(
        companyId,
        { kind: "payment_succeeded", periodEnd: periodEnd.toISOString() },
        { invoiceId: null, provider: ev.provider },
      );
      break;
    case "payment_failed":
    case "mandate_failed": {
      const failureCount = (await consecutiveFailures(companyId)) + 1;
      await processBillingEvent(
        companyId,
        { kind: "payment_failed", failureCount },
        { invoiceId: null, provider: ev.provider },
      );
      break;
    }
    case "subscription_cancelled":
      await processBillingEvent(
        companyId,
        { kind: "subscription_cancelled" },
        { provider: ev.provider },
      );
      break;
    default:
      await recordPaymentEvent({
        tenantId: companyId,
        provider: ev.provider,
        eventType: `webhook.${ev.type}`,
        actor: "webhook",
        data: ev.raw,
      });
  }
}
