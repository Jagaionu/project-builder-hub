import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_TENANT_CONFIG } from "@/lib/types";
import { loadPlanEntitlements } from "@/lib/billing/plan-entitlements.server";
import { sendEmail } from "@/lib/billing/email.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

function toSlug(v: string): string {
  const base = v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return base || "company";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 0; i < 6; i++) {
    const { data } = await sb.from("companies").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
    slug = base + "-" + Math.random().toString(36).slice(2, 6);
  }
  return base + "-" + Date.now().toString(36);
}

// PUBLIC self-serve signup. Creates the admin auth user UNCONFIRMED, a 14-day
// trial company and the admin membership, then emails a confirmation link via
// the configured email provider. Not usable until confirmed; the cleanup sweep
// removes unconfirmed accounts after 24h. Rolls back on any error.
export const signUpCompany = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        companyName: z.string().trim().min(2).max(100),
        adminName: z.string().trim().min(2).max(80),
        email: z.string().trim().email(),
        password: z.string().min(8).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase();
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: false,
      user_metadata: { name: data.adminName },
    });
    if (createErr || !created?.user) {
      const msg = createErr?.message ?? "";
      if (/registered|already/i.test(msg)) {
        throw new Error("An account with that email already exists. Please log in instead.");
      }
      throw new Error("Could not create your account. Please try again.");
    }
    const userId = created.user.id;
    let createdCompanyId: string | null = null;

    try {
      const slug = await uniqueSlug(toSlug(data.companyName));
      const trialEnds = new Date();
      trialEnds.setDate(trialEnds.getDate() + 14);
      const e = await loadPlanEntitlements("starter");
      const config = {
        ...DEFAULT_TENANT_CONFIG,
        modules: e.modules,
        maxDrivers: e.maxDrivers,
        maxWarehouses: e.maxWarehouses,
        customBranding: e.customBranding,
      };
      const { data: company, error: coErr } = await sb
        .from("companies")
        .insert({
          name: data.companyName.trim(),
          slug,
          plan: "starter",
          subscription_status: "trial",
          subscription_ends_at: trialEnds.toISOString(),
          config,
        } as never)
        .select("id")
        .maybeSingle();
      if (coErr || !company?.id) throw new Error(coErr?.message ?? "company insert failed");
      createdCompanyId = company.id as string;

      const { error: memErr } = await sb.from("company_members").insert({
        company_id: company.id,
        user_id: userId,
        role: "admin",
        name: data.adminName.trim(),
        email,
        must_set_password: false,
      } as never);
      if (memErr) throw new Error(memErr.message);

      const base = process.env.APP_BASE_URL ?? "";
      const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
        type: "signup",
        email,
        password: data.password,
        options: { redirectTo: base + "/login" },
      });
      const link =
        (linkData as { properties?: { action_link?: string } } | null)?.properties?.action_link ?? "";
      if (!link) throw new Error("Could not generate a confirmation link.");
      const Q = String.fromCharCode(34);
      const sent = await sendEmail({
        to: email,
        subject: "Confirm your email to start your Prime Route trial",
        text: "Welcome to The Prime Route. Confirm your email to activate your 14-day trial: " + link,
        html:
          "<p>Welcome to The Prime Route.</p>" +
          "<p>Confirm your email to activate your 14-day trial:</p>" +
          "<p><a href=" + Q + link + Q + ">Confirm my email</a></p>" +
          "<p>If the button does not work, paste this link into your browser:<br>" + link + "</p>",
      });
      if (!sent.ok) {
        throw new Error("We could not send the confirmation email. Please try again shortly.");
      }

      return { ok: true, needsConfirmation: true, email };
    } catch (err) {
      if (createdCompanyId) {
        await sb.from("companies").delete().eq("id", createdCompanyId).then(
          () => {},
          () => {},
        );
      }
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      throw new Error(err instanceof Error ? err.message : "Signup failed. Please try again.");
    }
  });
