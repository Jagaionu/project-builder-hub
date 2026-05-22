import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000));
    const { data } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("login_code", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("Failed to allocate unique code");
}

/**
 * Rotate a driver's permanent login code. Use this for the "regenerate" button.
 * The new code replaces the old one; the old code stops working immediately.
 */
export const rotateDriverLoginCode = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ driverId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const code = await generateUniqueCode();
    const { error } = await supabaseAdmin
      .from("drivers")
      .update({ login_code: code } as never)
      .eq("id", data.driverId);
    if (error) throw new Error(error.message);
    return { code };
  });

// Backwards-compat alias — same behaviour, kept so existing imports don't break.
export const generateDriverPairingCode = rotateDriverLoginCode;

/**
 * Returns the current permanent login codes for all drivers. Used by the
 * dispatch UI so codes survive page reloads.
 */
export const getActiveDriverPairingCodes = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("drivers")
    .select("id, login_code");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((d) => d.login_code)
    .map((d) => ({ driver_id: d.id as string, code: d.login_code as string, expires_at: null as string | null }));
});
