import { createFileRoute } from "@tanstack/react-router";
import { runCompleteRunsSweep } from "@/lib/dispatch/complete-runs-sweep.server";

// Scheduled (pg_cron) sweep that applies the arrival fallback and completes runs
// whose stops have all arrived and whose drop unload window has passed — so a
// finished run no longer depends on the driver's GPS loop or a dispatcher
// having the panel open.
export const Route = createFileRoute("/api/public/cron/complete-runs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!expected) return new Response("Server misconfigured", { status: 503 });
        const provided = request.headers.get("apikey") ?? "";
        if (provided !== expected) return new Response("Unauthorized", { status: 401 });
        const result = await runCompleteRunsSweep();
        return new Response(JSON.stringify({ ok: true, ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
