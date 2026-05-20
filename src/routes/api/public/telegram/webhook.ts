import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import { haversineKm, etaMinutes, isInsideGeofence } from "@/lib/geo";

/**
 * Telegram bot webhook.
 * Expected payloads from the bot:
 *   { telegram_id: string, type: "LOCATION_UPDATE", lat: number, lon: number }
 *   { telegram_id: string, type: "START_SHIFT" | "END_SHIFT" }
 *   { telegram_id: string, type: "ACCEPT_JOB" | "REJECT_JOB", job_id: string }
 *   { telegram_id: string, type: "DELAY_REPORT", reason?: string }
 */
const Payload = z.object({
  telegram_id: z.string().min(1).max(128),
  type: z.enum(["LOCATION_UPDATE","START_SHIFT","END_SHIFT","ACCEPT_JOB","REJECT_JOB","DELAY_REPORT","ARRIVED","DEPARTED"]),
  lat: z.number().optional(),
  lon: z.number().optional(),
  job_id: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const parsed = Payload.safeParse(body);
        if (!parsed.success) return json({ error: "Invalid payload", details: parsed.error.flatten() }, 400);
        const p = parsed.data;

        const { data: driver, error: drvErr } = await supabaseAdmin
          .from("drivers").select("*").eq("telegram_id", p.telegram_id).maybeSingle();
        if (drvErr) return json({ error: drvErr.message }, 500);
        if (!driver) return json({ error: "Unknown driver" }, 404);

        const updates: Record<string, unknown> = { last_update_time: new Date().toISOString() };

        if (p.type === "LOCATION_UPDATE" && p.lat != null && p.lon != null) {
          updates.current_lat = p.lat;
          updates.current_lon = p.lon;

          // Geofence detection against driver's active job destination
          const { data: activeJob } = await supabaseAdmin
            .from("jobs").select("*").eq("assigned_driver_id", driver.id)
            .in("status", ["ASSIGNED","IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"])
            .maybeSingle();

          if (activeJob) {
            const targetWhId = activeJob.status === "ASSIGNED" || activeJob.status === "IN_PROGRESS"
              ? activeJob.origin_warehouse_id
              : activeJob.destination_warehouse_id;
            const { data: wh } = await supabaseAdmin.from("warehouses").select("*").eq("id", targetWhId).maybeSingle();
            if (wh) {
              const inside = isInsideGeofence(p.lat, p.lon, wh.latitude, wh.longitude);
              if (inside && (activeJob.status === "ASSIGNED" || activeJob.status === "IN_PROGRESS")) {
                await supabaseAdmin.from("jobs").update({ status: "ARRIVED_PICKUP" }).eq("id", activeJob.id);
                await logEvent(driver.id, "ARRIVED", { job_id: activeJob.id, warehouse: wh.code });
              } else if (inside && activeJob.status === "EN_ROUTE_DELIVERY") {
                await supabaseAdmin.from("jobs").update({ status: "COMPLETED" }).eq("id", activeJob.id);
                await logEvent(driver.id, "ARRIVED", { job_id: activeJob.id, warehouse: wh.code, completed: true });
              } else {
                const distKm = haversineKm(p.lat, p.lon, wh.latitude, wh.longitude);
                await supabaseAdmin.from("jobs").update({ eta_minutes: etaMinutes(distKm) }).eq("id", activeJob.id);
              }
            }
          }
        }

        if (p.type === "START_SHIFT") updates.status = "AVAILABLE";
        if (p.type === "END_SHIFT") updates.status = "OFF_SHIFT";
        if (p.type === "DELAY_REPORT") updates.status = "DELAYED";
        if (p.type === "ACCEPT_JOB" && p.job_id) {
          updates.status = "ON_ROUTE";
          await supabaseAdmin.from("jobs").update({ status: "IN_PROGRESS" }).eq("id", p.job_id);
        }

        await supabaseAdmin.from("drivers").update(updates as never).eq("id", driver.id);
        await logEvent(driver.id, p.type, p as unknown as Record<string, unknown>);

        return json({ ok: true });
      },
    },
  },
});

async function logEvent(driver_id: string, type: string, payload: Record<string, unknown>) {
  await supabaseAdmin.from("driver_events").insert({ driver_id, type: type as never, payload: payload as never });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
