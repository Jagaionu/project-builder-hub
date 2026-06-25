import { createFileRoute } from "@tanstack/react-router";
import { dispatchDriverPush } from "@/lib/push/dispatch.server";

// Scheduled (pg_cron) sweep that sends queued driver notifications as web push.
export const Route = createFileRoute("/api/public/cron/push-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!expected) return new Response("Server misconfigured", { status: 503 });
        const provided = request.headers.get("apikey") ?? "";
        if (provided !== expected) return new Response("Unauthorized", { status: 401 });
        const result = await dispatchDriverPush();
        return new Response(JSON.stringify({ ok: true, ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
