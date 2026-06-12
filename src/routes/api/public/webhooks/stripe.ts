import { createFileRoute } from "@tanstack/react-router";
import { ingestWebhook } from "@/lib/billing/webhook-ingest.server";

// Stripe sends the signature in the `stripe-signature` header. The raw body
// must be read verbatim for signature verification (no parsing first).
export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => ingestWebhook("stripe", request),
    },
  },
});
