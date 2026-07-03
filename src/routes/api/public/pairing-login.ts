import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function genPassword() {
  return crypto.randomUUID() + crypto.randomUUID();
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function text(body: string, status = 200) {
  return new Response(body, { status, headers: CORS_HEADERS });
}

export const Route = createFileRoute("/api/public/pairing-login")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        let body: { code?: string };
        try {
          body = await request.json();
        } catch {
          return text("Bad JSON", 400);
        }
        const code = String(body?.code ?? "").replace(/\D/g, "");
        if (code.length !== 6) return text("Invalid code format", 400);
        const deviceId = String((body as { deviceId?: string })?.deviceId ?? "").slice(0, 100);

        // Permanent code: lookup directly on drivers.login_code
        // select * is intentional: tolerates bound_device_id not existing yet
        // (before the migration is run) instead of erroring the whole login.
        const { data: drv, error: drvErr } = await supabaseAdmin
          .from("drivers")
          .select("*")
          .eq("login_code", code)
          .maybeSingle();

        if (drvErr) {
          console.error("[pairing-login] driver lookup failed", drvErr);
          return text("Server error", 500);
        }
        if (!drv) return text("Code not found", 404);

        const email = `driver-${drv.id}@driver.local`;
        const password = genPassword();

        if (drv.user_id) {
          const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(drv.user_id, {
            password,
            email,
            email_confirm: true,
          });
          if (updErr) {
            console.error("[pairing-login] updateUserById failed", updErr);
            return text("Failed to issue session", 500);
          }
        } else {
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          });
          if (createErr || !created?.user) {
            console.error("[pairing-login] createUser failed", createErr);
            return text("Failed to issue session", 500);
          }
          const { error: patchErr } = await supabaseAdmin
            .from("drivers")
            .update({ user_id: created.user.id } as never)
            .eq("id", drv.id);
          if (patchErr) {
            console.error("[pairing-login] driver user_id patch failed", patchErr);
            return text("Failed to issue session", 500);
          }
        }

        // Device binding (anti code-sharing): one active device per code.
        // Last device wins — binding to a new device supersedes the previous
        // one, which self-ejects on its next load (its id no longer matches).
        if (deviceId) {
          const currentBound =
            (drv as { bound_device_id?: string | null }).bound_device_id ?? null;
          if (currentBound !== deviceId) {
            const { error: bindErr } = await supabaseAdmin
              .from("drivers")
              .update({
                bound_device_id: deviceId,
                bound_device_at: new Date().toISOString(),
              } as never)
              .eq("id", drv.id);
            if (bindErr) {
              // Column may not exist yet (migration not run) — never block login.
              console.warn("[pairing-login] device bind skipped:", bindErr.message);
            } else if (currentBound) {
              console.warn(`[pairing-login] driver ${drv.id} rebound to a new device (takeover)`);
            }
          }
        }

        return json({ email, password, driver: { id: drv.id, name: drv.name } });
      },
    },
  },
});
