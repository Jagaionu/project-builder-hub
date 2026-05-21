import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { timingSafeEqual } from "crypto";
import { haversineKm, etaMinutes, isInsideGeofence } from "@/lib/geo";
import { buildJobCard } from "@/lib/job-card.server";
import {
  deriveTelegramWebhookSecret,
  sendMessage,
  answerCallbackQuery,
  editMessageReplyMarkup,
  mainMenu,
  jobInlineKeyboard,
  delayReasonsKeyboard,
  emptyInlineKeyboard,
  deleteMessage,
} from "@/lib/telegram.server";
import { recomputeRecent } from "@/lib/shift-ledger.server";

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

// Multi-step state for the END_SHIFT → availability → location flow.
// Module-scoped Map; entries cleared once flow completes.
const pendingTomorrowState = new Map<
  string,
  "awaiting_answer" | "awaiting_location"
>();

const tomorrowLocationKeyboard = {
  keyboard: [[{ text: "📍 Share my location", request_location: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

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
  // Debounce shift toggles: Telegram occasionally replays queued updates after
  // a webhook re-registration, which can produce duplicate START/END events
  // within milliseconds. Drop those before they corrupt compliance maths.
  if (type === "START_SHIFT" || type === "END_SHIFT") {
    const { data: last } = await supabaseAdmin
      .from("driver_events")
      .select("type,timestamp")
      .eq("driver_id", driver_id)
      .in("type", ["START_SHIFT", "END_SHIFT"] as never)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) {
      const ageMs = Date.now() - new Date(last.timestamp as string).getTime();
      const sameType = last.type === type;
      if (sameType && ageMs < 10_000) return;
      if (!sameType && ageMs < 30_000) return;
    }
  }
  await supabaseAdmin.from("driver_events").insert({
    driver_id,
    type: type as never,
    payload: payload as never,
  });
  if (type === "START_SHIFT" || type === "END_SHIFT") {
    // Keep the daily hours ledger in sync. Errors here must not break the
    // webhook response, so swallow & log.
    try {
      await recomputeRecent(driver_id);
    } catch (err) {
      console.error("recomputeRecent failed", err);
    }
  }
}

async function listAssignedJobs(driverId: string) {
  const { data } = await supabaseAdmin
    .from("jobs")
    .select("id,reference,status,scheduled_at,planned_start_at")
    .or(`assigned_driver_id.eq.${driverId},planned_driver_id.eq.${driverId}`)
    .in("status", ["PENDING", "ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"])
    .order("planned_start_at", { ascending: true, nullsFirst: false })
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  return data ?? [];
}



async function jobCardAlreadySent(driverId: string, jobId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("driver_events")
    .select("id")
    .eq("driver_id", driverId)
    .eq("type", "JOB_CARD_SENT" as never)
    .contains("payload", { job_id: jobId } as never)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function pushAllAssignedJobs(driverId: string, chatId: number) {
  const jobs = await listAssignedJobs(driverId);
  let sent = 0;
  // Show at most the current job (active) + the next planned one.
  const active = jobs.filter((j) =>
    ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(j.status),
  );
  const planned = jobs.filter((j) => j.status === "PENDING").slice(0, 1);
  const visible = [...active, ...planned];
  for (const j of visible) {
    if (await jobCardAlreadySent(driverId, j.id)) continue;
    const card = await buildJobCard(j.id, driverId);
    if (!card) continue;
    let mode: "OFFER" | "ACCEPTED" | "NONE";
    if (j.status === "PENDING") mode = "NONE"; // planned/next — informational only
    else if (j.status === "ASSIGNED") mode = "OFFER";
    else mode = "ACCEPTED";
    const prefix = j.status === "PENDING" ? "🔜 <b>Next planned job</b>\n\n" : "";
    const resp = await sendMessage(chatId, prefix + card.text, jobInlineKeyboard(j.id, mode));
    const messageId = resp?.result?.message_id ?? null;
    await logEvent(driverId, "JOB_CARD_SENT", { job_id: j.id, message_id: messageId, chat_id: chatId });
    sent++;
  }
  return sent;
}

async function clearJobCardsFromChat(driverId: string, chatId: number) {
  // Delete all JOB_CARD_SENT messages we sent to this driver in the last 24h
  // so the chat is clean when the shift ends.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("driver_events")
    .select("payload")
    .eq("driver_id", driverId)
    .eq("type", "JOB_CARD_SENT" as never)
    .gte("timestamp", since);
  for (const row of (data ?? []) as Array<{ payload: { message_id?: number; chat_id?: number } }>) {
    const mid = row.payload?.message_id;
    if (mid) await deleteMessage(chatId, mid);
  }
  // Wipe the JOB_CARD_SENT log so cards can be re-sent on next shift.
  await supabaseAdmin
    .from("driver_events")
    .delete()
    .eq("driver_id", driverId)
    .eq("type", "JOB_CARD_SENT" as never);
}

async function hasActiveRoute(driverId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("jobs")
    .select("id")
    .eq("assigned_driver_id", driverId)
    .in("status", ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"])
    .limit(1)
    .maybeSingle();
  return !!data;
}

function endShiftConfirmKeyboard() {
  return {
    inline_keyboard: [[
      { text: "✅ Yes, end shift", callback_data: "END_SHIFT_CONFIRM" },
      { text: "↩️ No, keep going", callback_data: "END_SHIFT_CANCEL" },
    ]],
  };
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

  if (t === "/register" || t.toLowerCase() === "register") {
    await sendMessage(chatId, `You're already registered as <b>${driver.name}</b>. Use the menu below.`, mainMenu);
    return;
  }

  if (t.startsWith("/start") || t === "/menu") {
    await sendMessage(chatId, `Hi <b>${driver.name}</b>. Use the menu below.`, mainMenu);
    return;
  }


  if (t === "▶️ Start Shift" || t === "/start_shift") {
    if (driver.status !== "OFF_SHIFT") {
      // Already on shift — don't double-log or reset the clock.
      const { data: lastStart } = await supabaseAdmin
        .from("driver_events")
        .select("timestamp")
        .eq("driver_id", driver.id)
        .eq("type", "START_SHIFT" as never)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();
      const since = lastStart
        ? new Date(lastStart.timestamp as string).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : null;
      await sendMessage(
        chatId,
        since
          ? `ℹ️ You're already <b>on shift</b> since ${since}. Tap ⏹ End Shift when you're done.`
          : `ℹ️ You're already <b>on shift</b>. Tap ⏹ End Shift when you're done.`,
        mainMenu,
      );
      return;
    }
    await supabaseAdmin
      .from("drivers")
      .update({ status: "AVAILABLE", last_update_time: new Date().toISOString() })
      .eq("id", driver.id);
    await logEvent(driver.id, "START_SHIFT", {});
    await sendMessage(
      chatId,
      `▶️ <b>Shift started!</b> Your routes were sent yesterday evening.\nUse 📦 My Jobs to review them. Safe driving! 🚚`,
      mainMenu,
    );
    return;
  }

  if (t === "⏹ End Shift" || t === "/end_shift") {
    if (await hasActiveRoute(driver.id)) {
      await logEvent(driver.id, "END_SHIFT_BLOCKED", {});
      await sendMessage(
        chatId,
        `⚠️ <b>You still have an active route.</b>\n\nAre you sure you want to end your shift? Dispatch will need to re-plan your job.`,
        endShiftConfirmKeyboard(),
      );
      return;
    }
    await supabaseAdmin
      .from("drivers")
      .update({ status: "OFF_SHIFT", last_update_time: new Date().toISOString() })
      .eq("id", driver.id);
    await logEvent(driver.id, "END_SHIFT", {});
    await clearJobCardsFromChat(driver.id, chatId);
    await sendMessage(chatId, "🛑 <b>Shift ended.</b> Have a good rest!", mainMenu);
    await sendMessage(
      chatId,
      `⏹ Shift ended. Are you available for tomorrow's routes?\nReply <b>YES</b> or <b>NO</b>.`,
    );
    pendingTomorrowState.set(String(chatId), "awaiting_answer");
    return;
  }

  if (t === "📦 My Jobs" || t === "/jobs") {
    const n = await pushAllAssignedJobs(driver.id, chatId);
    if (n === 0) await sendMessage(chatId, "No new jobs. Stay tuned!", mainMenu);
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

async function handleCallback(
  chatId: number,
  driver: Driver | null,
  callbackId: string,
  data: string,
  messageId?: number,
) {
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
    // Replace the offer buttons with the single "Can't complete" escape hatch.
    if (messageId) {
      try { await editMessageReplyMarkup(chatId, messageId, jobInlineKeyboard(arg, "ACCEPTED")); } catch { /* ignore */ }
    }
    await sendMessage(
      chatId,
      `✅ Accepted. We'll detect pickup & drop-off automatically from your live location.`,
      mainMenu,
    );
    return;
  }
  if (action === "REJECT" && arg) {
    await supabaseAdmin.from("jobs").update({ status: "PENDING", assigned_driver_id: null, planned_driver_id: null }).eq("id", arg);
    await logEvent(driver.id, "REJECT_JOB", { job_id: arg });
    await answerCallbackQuery(callbackId, "Rejected");
    if (messageId) {
      try { await editMessageReplyMarkup(chatId, messageId, emptyInlineKeyboard); } catch { /* ignore */ }
    }
    await sendMessage(chatId, "❌ Job released back to dispatch.", mainMenu);
    return;
  }
  if (action === "CANT" && arg) {
    await supabaseAdmin
      .from("jobs")
      .update({ status: "PENDING", assigned_driver_id: null, planned_driver_id: null })
      .eq("id", arg);
    await supabaseAdmin.from("drivers").update({ status: "AVAILABLE" }).eq("id", driver.id);
    await logEvent(driver.id, "CANT_COMPLETE", { job_id: arg });
    await answerCallbackQuery(callbackId, "Dispatch notified");
    if (messageId) {
      try { await editMessageReplyMarkup(chatId, messageId, emptyInlineKeyboard); } catch { /* ignore */ }
    }
    await sendMessage(
      chatId,
      `🚫 Dispatch has been alerted. They'll re-plan this job.`,
      mainMenu,
    );
    return;
  }
  if (action === "ISSUE" && arg) {
    // Driver flags an issue but keeps the job. Marks driver DELAYED so the
    // alert surfaces on the Alerts tab without releasing the route.
    await supabaseAdmin.from("drivers").update({ status: "DELAYED" }).eq("id", driver.id);
    await logEvent(driver.id, "DELAY_REPORT", { job_id: arg, reason: "Driver flagged issue on job card" });
    await answerCallbackQuery(callbackId, "Dispatch alerted");
    await sendMessage(
      chatId,
      `⚠️ Dispatch has been alerted about an issue with this job. You still hold the route — continue if you can, or use 🚫 Can't complete to release it.`,
      mainMenu,
    );
    return;
  }
  if (action === "END_SHIFT_CONFIRM") {
    // Release any active jobs so they can be re-planned.
    await supabaseAdmin
      .from("jobs")
      .update({ status: "PENDING", assigned_driver_id: null, planned_driver_id: null })
      .eq("assigned_driver_id", driver.id)
      .in("status", ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"]);
    await supabaseAdmin
      .from("drivers")
      .update({ status: "OFF_SHIFT", last_update_time: new Date().toISOString() })
      .eq("id", driver.id);
    await logEvent(driver.id, "END_SHIFT", { had_active_route: true });
    await answerCallbackQuery(callbackId, "Shift ended");
    if (messageId) {
      try { await editMessageReplyMarkup(chatId, messageId, emptyInlineKeyboard); } catch { /* ignore */ }
    }
    await clearJobCardsFromChat(driver.id, chatId);
    await sendMessage(chatId, "🛑 Shift ended. Dispatch will re-plan your route.", mainMenu);
    return;
  }
  if (action === "END_SHIFT_CANCEL") {
    await answerCallbackQuery(callbackId, "Carrying on");
    if (messageId) {
      try { await editMessageReplyMarkup(chatId, messageId, emptyInlineKeyboard); } catch { /* ignore */ }
    }
    await sendMessage(chatId, "👍 Carrying on — drive safe.", mainMenu);
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
            const messageId = cb.message?.message_id;
            if (chatId) {
              const driver = await findDriver(chatId);
              await handleCallback(chatId, driver, cb.id, cb.data ?? "", messageId);
            }
          } else {
            const isEdit = !!update.edited_message;
            const msg = update.message ?? update.edited_message;
            const chatId = msg?.chat?.id;
            if (chatId) {
              const driver = await findDriver(chatId);
              if (msg.location && driver) {
                const reply = await handleLocation(driver, msg.location.latitude, msg.location.longitude);
                // Process live-location edits silently. Only chat back on first
                // share or on a meaningful state change (arrival / completion).
                if (reply && (!isEdit || reply.text.startsWith("📍 Arrived") || reply.text.startsWith("🏁") || reply.text.startsWith("📍 Drop"))) {
                  await sendMessage(chatId, reply.text, mainMenu);
                  // No re-send of the job card on ETA pings — drivers asked us
                  // not to spam the same route info repeatedly.
                } else if (!reply && !isEdit) {
                  // First-time location share — confirm + push any new jobs (deduped).
                  const n = await pushAllAssignedJobs(driver.id, chatId);
                  await sendMessage(
                    chatId,
                    n > 0
                      ? `📍 Live location received — ${n} new job(s) below.`
                      : "📍 Live location received — you'll get a route as soon as one is assigned.",
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
