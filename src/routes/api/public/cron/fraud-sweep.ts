import { createFileRoute } from "@tanstack/react-router";
import { runTrustedPromotionSweep } from "@/lib/fraud/trusted-sweep.server";
import { runBehaviouralRiskSweep } from "@/lib/fraud/behavioural-sweep.server";

// Scheduled (pg_cron) fraud sweep. Promotes long-standing paying companies to
// trusted. Extended by the behavioural risk sweep.
export const Route = createFileRoute("/api/public/cron/fraud-sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!expected) return new Response("Server misconfigured", { status: 503 });
        const provided = request.headers.get("apikey") ?? "";
        if (provided !== expected) return new Response("Unauthorized", { status: 401 });
        const trusted = await runTrustedPromotionSweep();
        const behaviour = await runBehaviouralRiskSweep();
        return new Response(JSON.stringify({ ok: true, trusted, behaviour }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
