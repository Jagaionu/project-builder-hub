import { createFileRoute } from "@tanstack/react-router";
import { recomputeAllRecent } from "@/lib/shift-ledger.server";

// Nightly cron. Caller (pg_cron via pg_net) must supply the Supabase
// anon/publishable key in an `apikey` header — the same key the rest of the
// public API uses. This prevents anonymous callers from triggering
// large recompute storms while keeping setup zero-config (no extra secret).

export const Route = createFileRoute("/api/public/cron/shift-rollover")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!expected) {
          return new Response("Server misconfigured", { status: 503 });
        }
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const url = new URL(request.url);
        const days = Math.max(1, Math.min(60, Number(url.searchParams.get("days")) || 2));
        const result = await recomputeAllRecent(days);
        return new Response(JSON.stringify({ ok: true, days, ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
