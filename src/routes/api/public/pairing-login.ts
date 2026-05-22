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
        try { body = await request.json(); } catch { return text("Bad JSON", 400); }
        const code = String(body?.code ?? "").replace(/\D/g, "");
        if (code.length !== 6) return text("Invalid code format", 400);

        // Permanent code: lookup directly on drivers.login_code
        const { data: drv, error: drvErr } = await supabaseAdmin
          .from("drivers")
          .select("id, user_id, name, login_code")
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
            password, email, email_confirm: true,
          });
          if (updErr) {
            console.error("[pairing-login] updateUserById failed", updErr);
            return text("Failed to issue session", 500);
          }
        } else {
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email, password, email_confirm: true,
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

        return json({ email, password, driver: { id: drv.id, name: drv.name } });
      },
    },
  },
});
