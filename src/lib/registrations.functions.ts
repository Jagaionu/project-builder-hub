import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendMessage, mainMenu } from "./telegram.server";

export const approveRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ registrationId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: reg, error: regErr } = await supabaseAdmin
      .from("driver_registrations")
      .select("id,telegram_id,name,phone,status,driver_id")
      .eq("id", data.registrationId)
      .maybeSingle();
    if (regErr) throw new Error(regErr.message);
    if (!reg) throw new Error("Registration not found");
    if (reg.status === "APPROVED") return { ok: true, alreadyApproved: true };
    if (!reg.name || !reg.phone) throw new Error("Registration incomplete");

    // Create driver
    const { data: driver, error: drvErr } = await supabaseAdmin
      .from("drivers")
      .insert({
        name: reg.name,
        phone: reg.phone,
        telegram_id: reg.telegram_id,
        status: "OFF_SHIFT",
      })
      .select("id")
      .single();
    if (drvErr) throw new Error(drvErr.message);

    await supabaseAdmin
      .from("driver_registrations")
      .update({ status: "APPROVED" as never, driver_id: driver.id })
      .eq("id", reg.id);

    await sendMessage(
      reg.telegram_id,
      `🎉 Welcome <b>${reg.name}</b>! Your account has been approved. Use the menu below to start your shift.`,
      mainMenu,
    );
    return { ok: true, driverId: driver.id };
  });

export const rejectRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ registrationId: z.string().uuid(), reason: z.string().max(300).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: reg } = await supabaseAdmin
      .from("driver_registrations")
      .select("id,telegram_id,name")
      .eq("id", data.registrationId)
      .maybeSingle();
    if (!reg) throw new Error("Registration not found");

    await supabaseAdmin
      .from("driver_registrations")
      .update({ status: "REJECTED" as never })
      .eq("id", reg.id);

    await sendMessage(
      reg.telegram_id,
      `❌ Sorry ${reg.name ?? ""}, your registration was not approved.${
        data.reason ? `\nReason: ${data.reason}` : ""
      }\n\nYou can send /register to try again.`,
    );
    return { ok: true };
  });
