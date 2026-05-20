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
    .select("id,reference,status,scheduled_at")
    .eq("assigned_driver_id", driverId)
    .in("status", ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"])
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  return data ?? [];
}



async function pushAllAssignedJobs(driverId: string, chatId: number) {
  const jobs = await listAssignedJobs(driverId);
  for (const j of jobs) {
    const card = await buildJobCard(j.id, driverId);
    if (card) await sendMessage(chatId, card.text, jobInlineKeyboard(j.id));
  }
  return jobs.length;
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
    .select("id,status")
    .eq("assigned_driver_id", driver.id)
    .in("status", ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"])
    .maybeSingle();

  if (!activeJob) return null;

  // Find next unarrived stop
  const { data: stops } = await supabaseAdmin
    .from("job_stops")
    .select("id,seq,kind,warehouse_id,arrived_at")
    .eq("job_id", activeJob.id)
    .order("seq", { ascending: true });
  const next = (stops ?? []).find((s) => !s.arrived_at);
  if (!next) return null;

  const { data: wh } = await supabaseAdmin
    .from("warehouses").select("*").eq("id", next.warehouse_id).maybeSingle();
  if (!wh) return null;

  const inside = isInsideGeofence(lat, lon, wh.latitude, wh.longitude);
  if (inside) {
    await supabaseAdmin.from("job_stops").update({ arrived_at: new Date().toISOString() }).eq("id", next.id);
    const remaining = (stops ?? []).filter((s) => s.id !== next.id && !s.arrived_at).length;
    if (next.kind === "PICKUP") {
      await supabaseAdmin.from("jobs").update({ status: "ARRIVED_PICKUP" }).eq("id", activeJob.id);
      await logEvent(driver.id, "ARRIVED", { job_id: activeJob.id, warehouse: wh.code, kind: "PICKUP" });
      return { text: `📍 Arrived pickup <b>${wh.code}</b>. Tap 🚚 Picked up when loaded.`, jobId: activeJob.id as string };
    }
    // DROP arrived
    if (remaining === 0) {
      await supabaseAdmin.from("jobs").update({ status: "COMPLETED" }).eq("id", activeJob.id);
      await supabaseAdmin.from("drivers").update({ status: "AVAILABLE" }).eq("id", driver.id);
      await logEvent(driver.id, "ARRIVED", { job_id: activeJob.id, warehouse: wh.code, completed: true });
      return { text: `🏁 Final drop complete at <b>${wh.code}</b>. Job done.`, jobId: null };
    }
    await logEvent(driver.id, "ARRIVED", { job_id: activeJob.id, warehouse: wh.code, kind: "DROP" });
    return { text: `📍 Drop done at <b>${wh.code}</b>. Continue to next stop.`, jobId: activeJob.id as string };
  }
  const distKm = haversineKm(lat, lon, wh.latitude, wh.longitude);
  const eta = etaMinutes(distKm);
  await supabaseAdmin.from("jobs").update({ eta_minutes: eta }).eq("id", activeJob.id);
  return { text: `📡 ETA to <b>${wh.code}</b>: ~${eta} min (${distKm.toFixed(1)} km).`, jobId: activeJob.id as string };
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

async function getRegistration(chatId: number) {
  const { data } = await supabaseAdmin
    .from("driver_registrations")
    .select("id,telegram_id,name,phone,status")
    .eq("telegram_id", String(chatId))
    .maybeSingle();
  return data;
}

async function handleRegistration(chatId: number, text: string): Promise<boolean> {
  const t = text.trim();
  const reg = await getRegistration(chatId);

  if (t === "/register" || t.toLowerCase() === "register") {
    if (reg && reg.status === "PENDING") {
      await sendMessage(chatId, "⏳ Your registration is awaiting approval. We'll notify you here.");
      return true;
    }
    if (reg && reg.status === "APPROVED") {
      await sendMessage(chatId, "✅ You are already approved.", mainMenu);
      return true;
    }
    await supabaseAdmin.from("driver_registrations").upsert(
      { telegram_id: String(chatId), name: null, phone: null, status: "AWAITING_NAME" as never },
      { onConflict: "telegram_id" },
    );
    await sendMessage(chatId, "📝 Let's get you registered. What's your <b>full name</b>?");
    return true;
  }

  if (!reg) return false;

  if (reg.status === "AWAITING_NAME") {
    if (t.length < 2 || t.length > 80) {
      await sendMessage(chatId, "Please send your full name (2–80 characters).");
      return true;
    }
    await supabaseAdmin
      .from("driver_registrations")
      .update({ name: t, status: "AWAITING_PHONE" as never })
      .eq("id", reg.id);
    await sendMessage(chatId, `Thanks <b>${t}</b>. Now send your <b>phone number</b> (e.g. +44…).`);
    return true;
  }

  if (reg.status === "AWAITING_PHONE") {
    if (!/^[+0-9 ()-]{6,20}$/.test(t)) {
      await sendMessage(chatId, "That doesn't look like a phone number. Try again (e.g. +44 7…).");
      return true;
    }
    await supabaseAdmin
      .from("driver_registrations")
      .update({ phone: t, status: "PENDING" as never })
      .eq("id", reg.id);
    await sendMessage(
      chatId,
      `✅ Registration submitted!\n\n<b>Name:</b> ${reg.name}\n<b>Phone:</b> ${t}\n\nDispatch will review shortly. You'll get a message here when approved.`,
    );
    return true;
  }

  if (reg.status === "PENDING") {
    await sendMessage(chatId, "⏳ Still awaiting approval — please hold tight.");
    return true;
  }

  if (reg.status === "REJECTED") {
    await sendMessage(chatId, "❌ Your previous registration was rejected. Send /register to try again.");
    return true;
  }

  return false;
}

async function handleText(chatId: number, driver: Driver | null, text: string) {
  const t = text.trim();

  if (!driver) {
    if (/^\d{6}$/.test(t)) {
      const linked = await tryPair(chatId, t);
      if (linked) {
        await sendMessage(chatId, `✅ Linked as <b>${linked.name}</b>. Use the menu below.`, mainMenu);
        return;
      }
      await sendMessage(chatId, "❌ Invalid or expired code. Ask dispatch for a fresh one, or send /register to sign up.");
      return;
    }

    if (await handleRegistration(chatId, t)) return;

    await sendMessage(
      chatId,
      `👋 Welcome! Two ways to get started:\n\n• Send /register to create a new account\n• Send your 6‑digit pairing code if dispatch gave you one\n\n(Your Telegram ID: <code>${chatId}</code>)`,
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
    const n = await pushAllAssignedJobs(driver.id, chatId);
    if (n === 0) await sendMessage(chatId, "No active jobs. Stay tuned!", mainMenu);
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
    const card = await buildJobCard(arg, driver.id);
    if (card) {
      await sendMessage(chatId, `✅ Accepted. Full route below — tap 📍 Share Location to keep ETAs live.`, mainMenu);
      await sendMessage(chatId, card.text, jobInlineKeyboard(arg));
    } else {
      await sendMessage(chatId, "✅ Accepted.", mainMenu);
    }
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
                if (reply) {
                  await sendMessage(chatId, reply.text, mainMenu);
                  if (reply.jobId) {
                    const card = await buildJobCard(reply.jobId, driver.id);
                    if (card) await sendMessage(chatId, card.text, jobInlineKeyboard(reply.jobId));
                  }
                } else {
                  // No active job — push any newly-assigned ones with fresh ETAs
                  const n = await pushAllAssignedJobs(driver.id, chatId);
                  await sendMessage(
                    chatId,
                    n > 0 ? `📍 Location received. ${n} job(s) ready below.` : "📍 Location received. No jobs yet.",
                    mainMenu,
                  );
                }
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
