import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendMessage, jobInlineKeyboard } from "./telegram.server";

async function loadWh(id: string) {
  const { data } = await supabaseAdmin
    .from("warehouses")
    .select("code,name,latitude,longitude,address")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export const notifyDriverOfJob = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select(
        "id,reference,status,assigned_driver_id,origin_warehouse_id,destination_warehouse_id,scheduled_at",
      )
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || !job.assigned_driver_id) return { skipped: "no_driver" };

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id,name,telegram_id")
      .eq("id", job.assigned_driver_id)
      .maybeSingle();
    if (!driver?.telegram_id) return { skipped: "driver_no_telegram" };

    const [o, d] = await Promise.all([
      loadWh(job.origin_warehouse_id),
      loadWh(job.destination_warehouse_id),
    ]);

    const when = job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "anytime";
    const text =
      `🚚 <b>New job assigned</b>\n` +
      `<b>${job.reference}</b>\n` +
      `📦 Pickup: ${o ? `${o.code} ${o.name}` : "—"}\n` +
      `🏁 Drop: ${d ? `${d.code} ${d.name}` : "—"}\n` +
      `🕒 ${when}`;

    await sendMessage(driver.telegram_id, text, jobInlineKeyboard(job.id));
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
