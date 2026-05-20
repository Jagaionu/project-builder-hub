import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { timingSafeEqual } from "crypto";
import { haversineKm, etaMinutes, isInsideGeofence } from "@/lib/geo";
import { buildJobCard } from "@/lib/job-card.server";
import {
  deriveTelegramWebhookSecret,
  sendMessage,
  answerCallbackQuery,
  mainMenu,
  jobInlineKeyboard,
  delayReasonsKeyboard,
} from "@/lib/telegram.server";

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

type Driver = {
  id: string;
  name: string;
  telegram_id: string | null;
  status: string;
};

async function findDriver(chatId: number): Promise<Driver | null> {
  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id,name,telegram_id,status")
    .eq("telegram_id", String(chatId))
    .maybeSingle();
  return (data as Driver) ?? null;
}

async function logEvent(driver_id: string, type: string, payload: Record<string, unknown>) {
  await supabaseAdmin.from("driver_events").insert({
    driver_id,
    type: type as never,
    payload: payload as never,
  });
}

async function listAssignedJobs(driverId: string) {
  const { data } = await supabaseAdmin
    .from("jobs")
    .select("id,reference,status,origin_warehouse_id,destination_warehouse_id,scheduled_at")
    .eq("assigned_driver_id", driverId)
    .in("status", ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"])
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  return data ?? [];
}

async function warehouseLabel(id: string | null): Promise<string> {
  if (!id) return "—";
  const { data } = await supabaseAdmin.from("warehouses").select("code,name").eq("id", id).maybeSingle();
  return data ? `${data.code} ${data.name}` : "—";
}

async function formatJob(j: {
  id: string;
  reference: string;
  status: string;
  origin_warehouse_id: string;
  destination_warehouse_id: string;
  scheduled_at: string | null;
}) {
  const [o, d] = await Promise.all([
    warehouseLabel(j.origin_warehouse_id),
    warehouseLabel(j.destination_warehouse_id),
  ]);
  const when = j.scheduled_at ? new Date(j.scheduled_at).toLocaleString() : "anytime";
  return `<b>${j.reference}</b> · ${j.status}\n📦 Pickup: ${o}\n🏁 Drop: ${d}\n🕒 ${when}`;
}

async function handleLocation(driver: Driver, lat: number, lon: number) {
  await supabaseAdmin
    .from("drivers")
    .update({
      current_lat: lat,
      current_lon: lon,
      last_update_time: new Date().toISOString(),
    })
    .eq("id", driver.id);
  await logEvent(driver.id, "LOCATION_UPDATE", { lat, lon });

  const { data: activeJob } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("assigned_driver_id", driver.id)
    .in("status", ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"])
    .maybeSingle();

  if (!activeJob) return null;

  const goingToPickup = activeJob.status === "ASSIGNED" || activeJob.status === "IN_PROGRESS";
  const targetWhId = goingToPickup ? activeJob.origin_warehouse_id : activeJob.destination_warehouse_id;
  const { data: wh } = await supabaseAdmin
    .from("warehouses")
    .select("*")
    .eq("id", targetWhId)
    .maybeSingle();
  if (!wh) return null;

  const inside = isInsideGeofence(lat, lon, wh.latitude, wh.longitude);
  if (inside && goingToPickup) {
    await supabaseAdmin.from("jobs").update({ status: "ARRIVED_PICKUP" }).eq("id", activeJob.id);
    await logEvent(driver.id, "ARRIVED", { job_id: activeJob.id, warehouse: wh.code });
    return `📍 Arrived at pickup <b>${wh.code}</b>.`;
  }
  if (inside && activeJob.status === "EN_ROUTE_DELIVERY") {
    await supabaseAdmin.from("jobs").update({ status: "COMPLETED" }).eq("id", activeJob.id);
    await logEvent(driver.id, "ARRIVED", { job_id: activeJob.id, warehouse: wh.code, completed: true });
    return `🏁 Job completed at <b>${wh.code}</b>.`;
  }
  const distKm = haversineKm(lat, lon, wh.latitude, wh.longitude);
  const eta = etaMinutes(distKm);
  await supabaseAdmin.from("jobs").update({ eta_minutes: eta }).eq("id", activeJob.id);
  return `📡 Location received. ETA to <b>${wh.code}</b>: ~${eta} min (${distKm.toFixed(1)} km).`;
}

async function tryPair(chatId: number, code: string): Promise<Driver | null> {
  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id,name,telegram_id,status,pairing_expires_at")
    .eq("pairing_code", code)
    .maybeSingle();
  if (!data) return null;
  if (data.pairing_expires_at && new Date(data.pairing_expires_at) < new Date()) return null;
  await supabaseAdmin
    .from("drivers")
    .update({ telegram_id: String(chatId), pairing_code: null, pairing_expires_at: null })
    .eq("id", data.id);
  return { id: data.id, name: data.name, telegram_id: String(chatId), status: data.status };
}

async function handleText(chatId: number, driver: Driver | null, text: string) {
  const t = text.trim();

  if (!driver) {
    // Self-link via 6-digit pairing code
    if (/^\d{6}$/.test(t)) {
      const linked = await tryPair(chatId, t);
      if (linked) {
        await sendMessage(chatId, `✅ Linked as <b>${linked.name}</b>. Use the menu below.`, mainMenu);
        return;
      }
      await sendMessage(chatId, "❌ Invalid or expired code. Ask dispatch for a fresh one.");
      return;
    }
    await sendMessage(
      chatId,
      `👋 Welcome! Send the 6‑digit code your dispatcher gave you to link this chat.\n(Your Telegram ID: <code>${chatId}</code>)`,
    );
    return;
  }


  // (t already trimmed above)

  if (t.startsWith("/start") || t === "/menu") {
    await sendMessage(chatId, `Hi <b>${driver.name}</b>. Use the menu below.`, mainMenu);
    return;
  }

  if (t === "▶️ Start Shift" || t === "/start_shift") {
    await supabaseAdmin
      .from("drivers")
      .update({ status: "AVAILABLE", last_update_time: new Date().toISOString() })
      .eq("id", driver.id);
    await logEvent(driver.id, "START_SHIFT", {});
    await sendMessage(chatId, "✅ Shift started. Please share your location to receive jobs.", mainMenu);
    return;
  }

  if (t === "⏹ End Shift" || t === "/end_shift") {
    await supabaseAdmin
      .from("drivers")
      .update({ status: "OFF_SHIFT", last_update_time: new Date().toISOString() })
      .eq("id", driver.id);
    await logEvent(driver.id, "END_SHIFT", {});
    await sendMessage(chatId, "🛑 Shift ended. Have a good rest!", mainMenu);
    return;
  }

  if (t === "📦 My Jobs" || t === "/jobs") {
    const jobs = await listAssignedJobs(driver.id);
    if (jobs.length === 0) {
      await sendMessage(chatId, "No active jobs. Stay tuned!", mainMenu);
      return;
    }
    for (const j of jobs) {
      const txt = await formatJob(j);
      await sendMessage(chatId, txt, jobInlineKeyboard(j.id));
    }
    return;
  }

  if (t === "⚠️ Report Delay" || t === "/delay") {
    await sendMessage(chatId, "Select a delay reason:", delayReasonsKeyboard());
    return;
  }

  if (t === "📍 Share Location") {
    await sendMessage(chatId, "Tap the 📍 button below to share your live location.", mainMenu);
    return;
  }

  await sendMessage(chatId, "I didn't recognise that. Use the menu below.", mainMenu);
}

async function handleCallback(chatId: number, driver: Driver | null, callbackId: string, data: string) {
  if (!driver) {
    await answerCallbackQuery(callbackId, "Not registered.");
    return;
  }
  const [action, ...rest] = data.split(":");
  const arg = rest.join(":");

  if (action === "ACCEPT" && arg) {
    await supabaseAdmin.from("jobs").update({ status: "IN_PROGRESS" }).eq("id", arg);
    await supabaseAdmin.from("drivers").update({ status: "ON_ROUTE" }).eq("id", driver.id);
    await logEvent(driver.id, "ACCEPT_JOB", { job_id: arg });
    await answerCallbackQuery(callbackId, "Accepted");
    const { data: job } = await supabaseAdmin
      .from("jobs").select("origin_warehouse_id").eq("id", arg).maybeSingle();
    const { data: wh } = job
      ? await supabaseAdmin.from("warehouses").select("code,name,latitude,longitude").eq("id", job.origin_warehouse_id).maybeSingle()
      : { data: null };
    const maps = wh ? `\n🗺 https://maps.google.com/?q=${wh.latitude},${wh.longitude}` : "";
    await sendMessage(
      chatId,
      `✅ Job accepted. Head to pickup${wh ? ` <b>${wh.code} ${wh.name}</b>` : ""}.${maps}\nTap 📍 Share Location so we can track ETA.`,
      mainMenu,
    );
    return;
  }
  if (action === "REJECT" && arg) {
    await supabaseAdmin.from("jobs").update({ status: "PENDING", assigned_driver_id: null }).eq("id", arg);
    await logEvent(driver.id, "REJECT_JOB", { job_id: arg });
    await answerCallbackQuery(callbackId, "Rejected");
    await sendMessage(chatId, "❌ Job released back to dispatch.", mainMenu);
    return;
  }
  if (action === "PICKED" && arg) {
    await supabaseAdmin.from("jobs").update({ status: "EN_ROUTE_DELIVERY" }).eq("id", arg);
    await logEvent(driver.id, "DEPARTED", { job_id: arg });
    await answerCallbackQuery(callbackId, "Picked up");
    await sendMessage(chatId, "🚚 Marked as picked up. Driving to drop-off.", mainMenu);
    return;
  }
  if (action === "DELIVERED" && arg) {
    await supabaseAdmin.from("jobs").update({ status: "COMPLETED" }).eq("id", arg);
    await supabaseAdmin.from("drivers").update({ status: "AVAILABLE" }).eq("id", driver.id);
    await logEvent(driver.id, "ARRIVED", { job_id: arg, completed: true });
    await answerCallbackQuery(callbackId, "Delivered");
    await sendMessage(chatId, "🏁 Job completed. Great work!", mainMenu);
    return;
  }
  if (action === "DELAY") {
    await supabaseAdmin
      .from("drivers")
      .update({ status: "DELAYED", last_update_time: new Date().toISOString() })
      .eq("id", driver.id);
    await logEvent(driver.id, "DELAY_REPORT", { reason: arg });
    await answerCallbackQuery(callbackId, "Reported");
    await sendMessage(chatId, `⚠️ Delay reported: <b>${arg}</b>. Dispatch has been notified.`, mainMenu);
    return;
  }
  await answerCallbackQuery(callbackId);
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Verify Telegram secret token
        let expected: string;
        try {
          expected = deriveTelegramWebhookSecret();
        } catch (e) {
          return new Response("Server not configured", { status: 500 });
        }
        const actual = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (!safeEqual(actual, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let update: any;
        try {
          update = await request.json();
        } catch {
          return Response.json({ ok: true });
        }

        try {
          if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message?.chat?.id ?? cb.from?.id;
            if (chatId) {
              const driver = await findDriver(chatId);
              await handleCallback(chatId, driver, cb.id, cb.data ?? "");
            }
          } else {
            const msg = update.message ?? update.edited_message;
            const chatId = msg?.chat?.id;
            if (chatId) {
              const driver = await findDriver(chatId);
              if (msg.location && driver) {
                const reply = await handleLocation(driver, msg.location.latitude, msg.location.longitude);
                if (reply) await sendMessage(chatId, reply, mainMenu);
                else await sendMessage(chatId, "📍 Location received.", mainMenu);
              } else if (typeof msg.text === "string") {
                await handleText(chatId, driver, msg.text);
              }
            }
          }
        } catch (err) {
          console.error("Telegram webhook error", err);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
