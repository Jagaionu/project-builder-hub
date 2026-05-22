import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const generateDriverPairingCode = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ driverId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    // Invalidate older unused codes for this driver
    await supabaseAdmin
      .from("pairing_codes")
      .update({ consumed_at: new Date().toISOString() } as never)
      .eq("driver_id", data.driverId)
      .is("consumed_at", null);
    const { error } = await supabaseAdmin
      .from("pairing_codes")
      .insert({ code, driver_id: data.driverId, expires_at: expires } as never);
    if (error) throw new Error(error.message);
    return { code, expires };
  });
