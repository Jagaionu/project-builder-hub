// Two-stage webhook ingestion. Persist the raw, signature-bearing event to
// webhook_incoming FIRST (dead-letter), then verify + process. Failures leave
// processed_at NULL so a super admin can replay them.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProvider } from "./registry";
import { handleNormalisedEvent } from "./orchestrator.server";
import type { Provider } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export async function ingestWebhook(
  providerId: Extract<Provider, "stripe" | "gocardless">,
  request: Request,
): Promise<Response> {
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const signature = headers["stripe-signature"] ?? headers["webhook-signature"] ?? null;

  // Stage 1: land the raw event. Dedupe on (provider, event_id) where known.
  const { data: landed } = await sb
    .from("webhook_incoming")
    .insert({ provider: providerId, signature, headers, raw_body: rawBody })
    .select("id")
    .maybeSingle();
  const rowId = landed?.id as string | undefined;

  // Stage 2: verify + parse + process.
  try {
    const provider = getProvider(providerId);
    const event = await provider.parseWebhook(rawBody, headers);

    // Backfill the decoded event id (enables replay dedupe).
    if (rowId)
      await sb.from("webhook_incoming").update({ event_id: event.eventId }).eq("id", rowId);

    await handleNormalisedEvent(event);

    if (rowId)
      await sb
        .from("webhook_incoming")
        .update({ processed_at: new Date().toISOString(), error: null })
        .eq("id", rowId);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (rowId) {
      await sb.from("webhook_incoming").update({ error: message }).eq("id", rowId);
    }
    // Signature failures are a client error; processing errors are persisted
    // for replay but we still signal non-2xx so the provider retries.
    const status = /signature/i.test(message) ? 400 : 500;
    return new Response(JSON.stringify({ received: false, error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
