// Scheduled billing sweep (run via pg_cron / pg_net like the other crons):
//  1. Suspend companies whose trial has expired.
//  2. Alert if too many webhooks remain unprocessed (dead-letter backlog).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processBillingEvent, recordPaymentEvent } from "./orchestrator.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export interface SweepResult {
  trialsExpired: number;
  webhooksPending: number;
  webhookAlert: boolean;
}

const WEBHOOK_ALERT_THRESHOLD = 5;
const WEBHOOK_STALE_MINUTES = 60;

export async function runBillingSweep(): Promise<SweepResult> {
  const nowIso = new Date().toISOString();

  // 1. Expire trials that have run past their end date.
  const { data: expiredTrials } = await sb
    .from("companies")
    .select("id")
    .eq("subscription_status", "trial")
    .lt("subscription_ends_at", nowIso);

  let trialsExpired = 0;
  for (const c of (expiredTrials ?? []) as Array<{ id: string }>) {
    await processBillingEvent(c.id, { kind: "trial_expired" }, {});
    trialsExpired += 1;
  }

  // 2. Webhook backlog alert.
  const staleBefore = new Date(Date.now() - WEBHOOK_STALE_MINUTES * 60_000).toISOString();
  const { count } = await sb
    .from("webhook_incoming")
    .select("id", { count: "exact", head: true })
    .is("processed_at", null)
    .lt("received_at", staleBefore);
  const webhooksPending = count ?? 0;
  const webhookAlert = webhooksPending > WEBHOOK_ALERT_THRESHOLD;
  if (webhookAlert) {
    await recordPaymentEvent({
      tenantId: null,
      eventType: "alert.webhooks_pending",
      actor: "system",
      data: { pending: webhooksPending, thresholdMinutes: WEBHOOK_STALE_MINUTES },
    });
  }

  return { trialsExpired, webhooksPending, webhookAlert };
}
