import { createFileRoute } from "@tanstack/react-router";
import { runSignupCleanup } from "@/lib/signup-cleanup.server";

// Scheduled (pg_cron) cleanup: delete unconfirmed accounts after 24h and
// abandoned, never-activated trials after 21 days.
export const Route = createFileRoute("/api/public/cron/signup-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!expected) return new Response("Server misconfigured", { status: 503 });
        const provided = request.headers.get("apikey") ?? "";
        if (provided !== expected) return new Response("Unauthorized", { status: 401 });
        const result = await runSignupCleanup();
        return new Response(JSON.stringify({ ok: true, ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
