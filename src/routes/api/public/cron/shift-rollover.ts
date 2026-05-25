import { createFileRoute } from "@tanstack/react-router";
import { recomputeAllRecent } from "@/lib/shift-ledger.server";

// Nightly cron. Caller must supply the CRON_SECRET shared secret via
// `Authorization: Bearer <secret>` or `?secret=<secret>`.

export const Route = createFileRoute("/api/public/cron/shift-rollover")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected) {
          return new Response("Cron secret not configured", { status: 503 });
        }
        const url = new URL(request.url);
        const headerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const queryToken = url.searchParams.get("secret") ?? "";
        const provided = headerToken || queryToken;
        if (provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
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
