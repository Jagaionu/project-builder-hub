import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendMessage, jobInlineKeyboard } from "./telegram.server";
import { buildJobCard } from "./job-card.server";

export const notifyDriverOfJob = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("id,assigned_driver_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || !job.assigned_driver_id) return { skipped: "no_driver" };

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("telegram_id")
      .eq("id", job.assigned_driver_id)
      .maybeSingle();
    if (!driver?.telegram_id) return { skipped: "driver_no_telegram" };

    // Dedupe: never send the same job card to the same driver twice.
    const { data: already } = await supabaseAdmin
      .from("driver_events")
      .select("id")
      .eq("driver_id", job.assigned_driver_id)
      .eq("type", "JOB_CARD_SENT" as never)
      .contains("payload", { job_id: data.jobId } as never)
      .limit(1)
      .maybeSingle();
    if (already) return { skipped: "already_sent" };

    const card = await buildJobCard(job.id, job.assigned_driver_id);
    if (!card) return { skipped: "no_card" };

    await sendMessage(driver.telegram_id, card.text, jobInlineKeyboard(job.id, "OFFER"));
    await supabaseAdmin.from("driver_events").insert({
      driver_id: job.assigned_driver_id,
      type: "JOB_CARD_SENT" as never,
      payload: { job_id: data.jobId } as never,
    });
    return { ok: true };
  });


export const notifyDriverJobUpdate = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ jobId: z.string().uuid(), message: z.string().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("assigned_driver_id,reference")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job?.assigned_driver_id) return { skipped: true };
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("telegram_id")
      .eq("id", job.assigned_driver_id)
      .maybeSingle();
    if (!driver?.telegram_id) return { skipped: true };
    await sendMessage(driver.telegram_id, `<b>${job.reference}</b>: ${data.message}`);
    return { ok: true };
  });

export const generatePairingCode = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ driverId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from("drivers")
      .update({ pairing_code: code, pairing_expires_at: expires })
      .eq("id", data.driverId);
    if (error) throw new Error(error.message);
    return { code, expires };
  });
