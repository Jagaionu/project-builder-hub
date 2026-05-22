import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function genPassword() {
  return crypto.randomUUID() + crypto.randomUUID();
}

export const Route = createFileRoute("/api/public/pairing-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { code?: string };
        try { body = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
        const code = String(body?.code ?? "").replace(/\D/g, "");
        if (code.length !== 6) return new Response("Invalid code format", { status: 400 });

        const { data: pc, error: pcErr } = await supabaseAdmin
          .from("pairing_codes")
          .select("code, driver_id, expires_at, consumed_at")
          .eq("code", code)
          .maybeSingle();

        if (pcErr) return new Response("Server error", { status: 500 });
        if (!pc) return new Response("Code not found", { status: 404 });
        if (pc.consumed_at) return new Response("Code already used", { status: 410 });
        if (pc.expires_at && new Date(pc.expires_at) < new Date()) {
          return new Response("Code expired", { status: 410 });
        }

        const { data: drv, error: drvErr } = await supabaseAdmin
          .from("drivers")
          .select("id, user_id, name")
          .eq("id", pc.driver_id)
          .single();
        if (drvErr || !drv) return new Response("Driver not found", { status: 404 });

        const email = `driver-${drv.id}@driver.local`;
        const password = genPassword();

        if (drv.user_id) {
          const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(drv.user_id, {
            password, email, email_confirm: true,
          });
          if (updErr) {
            console.error("updateUserById failed", updErr);
            return new Response("Failed to issue session", { status: 500 });
          }
        } else {
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email, password, email_confirm: true,
          });
          if (createErr || !created?.user) {
            console.error("createUser failed", createErr);
            return new Response("Failed to issue session", { status: 500 });
          }
          const { error: patchErr } = await supabaseAdmin
            .from("drivers")
            .update({ user_id: created.user.id } as never)
            .eq("id", drv.id);
          if (patchErr) {
            console.error("driver user_id patch failed", patchErr);
            return new Response("Failed to issue session", { status: 500 });
          }
        }

        await supabaseAdmin
          .from("pairing_codes")
          .update({ consumed_at: new Date().toISOString() } as never)
          .eq("code", code);

        return Response.json({ email, password });
      },
    },
  },
});
