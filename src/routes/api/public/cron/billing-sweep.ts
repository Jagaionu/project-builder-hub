import { createFileRoute } from "@tanstack/react-router";
import { runBillingSweep } from "@/lib/billing/billing-sweep.server";

// Scheduled billing sweep. Caller (pg_cron via pg_net) must supply the
// Supabase anon/publishable key in an `apikey` header — same convention as
// the shift-rollover cron.
export const Route = createFileRoute("/api/public/cron/billing-sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!expected) return new Response("Server misconfigured", { status: 503 });
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (provided !== expected) return new Response("Unauthorized", { status: 401 });

        const result = await runBillingSweep();
        return new Response(JSON.stringify({ ok: true, ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
