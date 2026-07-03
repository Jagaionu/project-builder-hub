import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device-id";

export async function loginWithPairingCode(code: string) {
  const res = await fetch("/api/public/pairing-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceId: getDeviceId() }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || "Invalid pairing code");
  }
  const { email, password } = (await res.json()) as { email: string; password: string };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function driverLogout() {
  await supabase.auth.signOut();
}
