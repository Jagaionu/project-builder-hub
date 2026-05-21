import { createFileRoute } from "@tanstack/react-router";
import { recomputeAllRecent } from "@/lib/shift-ledger.server";

// Nightly cron: recomputes the last 2 days of driver_day_hours for every
// driver, so any open shift gets rolled forward across midnight without
// requiring a fresh Telegram event.
//
// Wire to pg_cron with e.g.
//   select cron.schedule(
//     'shift-rollover',
//     '5 0 * * *',  -- 00:05 every day
//     $$ select net.http_post(
//          url := 'https://project--<id>.lovable.app/api/public/cron/shift-rollover',
//          headers := '{"Content-Type": "application/json"}'::jsonb,
//          body := '{}'::jsonb
//        ); $$
//   );

export const Route = createFileRoute("/api/public/cron/shift-rollover")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
