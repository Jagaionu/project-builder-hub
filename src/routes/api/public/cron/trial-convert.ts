import { createFileRoute } from "@tanstack/react-router";
import { runTrialConversionSweep } from "@/lib/pricing/trial-convert.server";

// Scheduled (pg_cron) sweep: auto-convert paid trials whose trial period has
// ended into the ongoing monthly subscription.
export const Route = createFileRoute("/api/public/cron/trial-convert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!expected) return new Response("Server misconfigured", { status: 503 });
        const provided = request.headers.get("apikey") ?? "";
        if (provided !== expected) return new Response("Unauthorized", { status: 401 });
        const result = await runTrialConversionSweep();
        return new Response(JSON.stringify({ ok: true, ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
