import { createFileRoute } from "@tanstack/react-router";
import { ingestWebhook } from "@/lib/billing/webhook-ingest.server";

// GoCardless signs the raw body with HMAC-SHA256 in the `Webhook-Signature`
// header (verified against GOCARDLESS_WEBHOOK_SECRET in the provider).
export const Route = createFileRoute("/api/public/webhooks/gocardless")({
  server: {
    handlers: {
      POST: async ({ request }) => ingestWebhook("gocardless", request),
    },
  },
});
