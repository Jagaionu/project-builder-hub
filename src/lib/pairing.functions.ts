import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const generateDriverPairingCode = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ driverId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    // Extended to 24 hours so drivers have time to install the app
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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

// Uses the admin client so it bypasses the USING(false) RLS policy on pairing_codes.
// The regular supabase client can never read this table — only the server can.
export const getActiveDriverPairingCodes = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data } = await supabaseAdmin
      .from("pairing_codes")
      .select("code, driver_id, expires_at")
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString());
    return (data ?? []) as Array<{ code: string; driver_id: string; expires_at: string | null }>;
  });
