import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_TENANT_CONFIG } from "@/lib/types";
import { loadPlanEntitlements } from "@/lib/billing/plan-entitlements.server";
import { sendEmail } from "@/lib/billing/email.server";
import { loadFraudSettings, loadEmailDomainSets } from "@/lib/fraud/fraud-config.server";
import type { FraudSettings } from "@/lib/fraud/fraud-config";
import { normalizeEmail, emailDomain, classifyEmailDomain } from "@/lib/fraud/email";
import {
  computeIdentityTrust,
  computeFraudRisk,
  decideSignup,
  cooldownActive,
  type VerificationMethod,
} from "@/lib/fraud/scoring";
import { getCompany } from "@/lib/fraud/companies-house.server";
import { checkRateLimit, recordSignupEvent } from "@/lib/fraud/rate-limit.server";
import { sanitizeIdent } from "@/lib/fraud/rate-limit";

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

async function seenBefore(col: string, val: string): Promise<boolean> {
  try {
    const { count } = await sb
      .from("signup_events")
      .select("id", { count: "exact", head: true })
      .eq(col, val)
      .in("outcome", ["created", "pending_review"]);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

async function recentFailed(ip: string | null, deviceId: string | null): Promise<boolean> {
  if (!ip && !deviceId) return false;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const ors: string[] = [];
  if (ip) ors.push("ip.eq." + sanitizeIdent(ip));
  if (deviceId) ors.push("device_id.eq." + sanitizeIdent(deviceId));
  try {
    const { count } = await sb
      .from("signup_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .in("outcome", ["blocked", "rate_limited"])
      .or(ors.join(","));
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeLedger(row: Record<string, any>): Promise<string | null> {
  try {
    const { data } = await sb.from("trial_signups").insert(row as never).select("id").maybeSingle();
    return (data?.id as string) ?? null;
  } catch {
    return null;
  }
}

async function logStep(
  signupId: string | null,
  tenantId: string | null,
  step: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: Record<string, any>,
): Promise<void> {
  try {
    await sb
      .from("signup_decision_log")
      .insert({ signup_id: signupId, tenant_id: tenantId, step, detail } as never);
  } catch {
    // tolerant pre-migration
  }
}

async function notifySuperAdmins(subject: string, text: string): Promise<void> {
  try {
    const { data } = await sb.from("super_admins").select("user_id");
    const ids = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id).slice(0, 5);
    for (const id of ids) {
      try {
        const u = await supabaseAdmin.auth.admin.getUserById(id);
        const to = u.data?.user?.email;
        if (to) await sendEmail({ to, subject, text, html: "<p>" + text + "</p>" });
      } catch {
        // best effort
      }
    }
  } catch {
    // best effort
  }
}

// PUBLIC self-serve signup with the full abuse pipeline:
// rate-limit -> Companies House re-validate -> duplicate/cooldown block ->
// identity-trust + fraud-risk scoring -> decision -> create account (active
// trial, or inactive pending_review) -> confirm email -> notify -> ledger +
// events + decision log. Never reveals the reason to the user.
export const signUpCompany = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        companyName: z.string().trim().min(2).max(120),
        adminName: z.string().trim().min(2).max(80),
        email: z.string().trim().email(),
        password: z.string().min(8).max(200),
        directorName: z.string().trim().max(120).optional(),
        companyNumber: z.string().trim().max(20).optional(),
        companyHouseName: z.string().trim().max(200).optional(),
        verificationMethod: z.enum(["companies_house", "manual"]).optional(),
        deviceId: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase();
    const normEmail = normalizeEmail(email);
    const domain = emailDomain(email);
    const deviceId = data.deviceId ?? null;

    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const req = getRequest();
      const h = req?.headers;
      if (h) {
        ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
        userAgent = h.get("user-agent");
      }
    } catch {
      // headers unavailable
    }

    const cfg: FraudSettings = await loadFraudSettings();

    // 1. Rate limit (before any expensive work).
    const rl = await checkRateLimit({ ip, deviceId }, cfg);
    if (rl.limited) {
      await recordSignupEvent({ email, emailDomain: domain, ip, deviceId, userAgent, outcome: "rate_limited" });
      throw new Error("Too many attempts from this connection. Please try again in a few minutes.");
    }
    await recordSignupEvent({
      email,
      emailDomain: domain,
      companyNumber: data.companyNumber ?? null,
      ip,
      deviceId,
      userAgent,
      outcome: "attempt",
    });

    // 2. Companies House re-validation.
    let verificationMethod: VerificationMethod =
      data.verificationMethod === "companies_house" ? "companies_house" : "manual";
    let companyNumber = (data.companyNumber ?? "").trim();
    let companyName = data.companyName.trim();
    let chConfirmed = false;
    if (verificationMethod === "companies_house" && companyNumber) {
      const prof = await getCompany(companyNumber);
      if (prof && prof.companyNumber) {
        chConfirmed = true;
        companyNumber = prof.companyNumber;
        companyName = prof.title || companyName;
      } else {
        verificationMethod = "manual";
        companyNumber = "";
      }
    } else {
      verificationMethod = "manual";
      companyNumber = "";
    }

    // 3. Duplicate within cooldown (verified company numbers only).
    let duplicateWithinCooldown = false;
    if (verificationMethod === "companies_house" && companyNumber) {
      const { data: prior } = await sb
        .from("trial_signups")
        .select("created_at, last_trial_at")
        .eq("company_number", companyNumber)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prior) {
        const last = new Date(prior.last_trial_at ?? prior.created_at).getTime();
        duplicateWithinCooldown = cooldownActive(last, Date.now(), cfg.cooldownMonths);
      }
    }

    // 4. Scoring.
    const { free, disposable } = await loadEmailDomainSets();
    const emailKind = classifyEmailDomain(domain, free, disposable);
    const businessEmail = emailKind === "business";
    const directorProvided = !!(data.directorName && data.directorName.trim());
    const identityTrust = computeIdentityTrust(
      { verificationMethod, businessEmail, directorProvided },
      cfg,
    );
    const deviceSeenBefore = deviceId ? await seenBefore("device_id", deviceId) : false;
    const ipSeenBefore = ip ? await seenBefore("ip", ip) : false;
    const recentFailedSignups = await recentFailed(ip, deviceId);
    const fraudRisk = computeFraudRisk(
      { deviceSeenBefore, ipSeenBefore, emailKind, recentFailedSignups },
      cfg,
    );

    // 5. Decision.
    const { decision, reasons } = decideSignup(
      {
        identityTrust,
        fraudRisk,
        chVerified: verificationMethod === "companies_house",
        duplicateWithinCooldown,
        alreadyTrusted: false,
      },
      cfg,
    );

    const ledgerBase = {
      email,
      normalized_email: normEmail,
      email_domain: domain,
      company_number: companyNumber || null,
      company_name: companyName,
      director_name: data.directorName?.trim() || null,
      verification_method: verificationMethod,
      identity_trust: identityTrust,
      fraud_risk: fraudRisk,
      ip,
      device_id: deviceId,
      user_agent: userAgent,
      last_trial_at: new Date().toISOString(),
    };

    // 6. Blocked (returning customer within cooldown) - no account created.
    if (decision === "blocked") {
      await recordSignupEvent({ email, emailDomain: domain, companyNumber, ip, deviceId, userAgent, outcome: "blocked" });
      const sid = await writeLedger({ ...ledgerBase, decision, status: "blocked", reason: { reasons } });
      await logStep(sid, null, "decision", { decision, reasons, identityTrust, fraudRisk });
      throw new Error(
        "Our records show this business has already used a free trial. Please log in, or contact us for a personalised demo.",
      );
    }

    // 7. Create the account. It is created immediately but stays inactive
    //    (pending_review) until approved when the decision is not active.
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
      const slug = await uniqueSlug(toSlug(companyName));
      const trialEnds = new Date();
      trialEnds.setDate(trialEnds.getDate() + 7);
      const ent = await loadPlanEntitlements("starter");
      const config = {
        ...DEFAULT_TENANT_CONFIG,
        modules: ent.modules,
        maxDrivers: ent.maxDrivers,
        maxWarehouses: ent.maxWarehouses,
        customBranding: ent.customBranding,
      };
      const verificationStatus = decision === "active" ? "verified" : "pending_review";
      const { data: company, error: coErr } = await sb
        .from("companies")
        .insert({
          name: companyName,
          slug,
          plan: "starter",
          subscription_status: "trial",
          subscription_ends_at: trialEnds.toISOString(),
          config,
          company_number: companyNumber || null,
          company_house_name: (data.companyHouseName ?? "").trim() || (chConfirmed ? companyName : null),
          director_name: data.directorName?.trim() || null,
          verification_method: verificationMethod,
          verification_status: verificationStatus,
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
        text: "Welcome to The Prime Route. Confirm your email to activate your 7-day trial: " + link,
        html:
          "<p>Welcome to The Prime Route.</p>" +
          "<p>Confirm your email to activate your 7-day trial:</p>" +
          "<p><a href=" + Q + link + Q + ">Confirm my email</a></p>" +
          "<p>If the button does not work, paste this link into your browser:<br>" + link + "</p>",
      });
      if (!sent.ok) {
        console.error("signup confirmation email failed:", sent.error);
        throw new Error("We could not send the confirmation email. Please try again shortly.");
      }

      await recordSignupEvent({
        email,
        emailDomain: domain,
        companyNumber,
        ip,
        deviceId,
        userAgent,
        outcome: decision === "active" ? "created" : "pending_review",
      });
      const sid = await writeLedger({
        ...ledgerBase,
        tenant_id: createdCompanyId,
        decision,
        status: decision === "active" ? "approved" : "pending_review",
        reason: { reasons },
      });
      await logStep(sid, createdCompanyId, "companies_house", { verified: chConfirmed, companyNumber });
      await logStep(sid, createdCompanyId, "duplicate_check", { duplicateWithinCooldown });
      await logStep(sid, createdCompanyId, "scoring", { identityTrust, fraudRisk, emailKind, deviceSeenBefore, ipSeenBefore, recentFailedSignups });
      await logStep(sid, createdCompanyId, "decision", { decision, reasons });

      if (decision !== "active") {
        await notifySuperAdmins(
          "New signup pending review",
          "A new trial signup for " + companyName + " requires review (identity trust " + identityTrust + ", fraud risk " + fraudRisk + ").",
        );
      }

      return { ok: true, needsConfirmation: true, pendingReview: decision !== "active", email };
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
