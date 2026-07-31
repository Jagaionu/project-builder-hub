// Super-admin security server functions: recovery codes + audit log reads.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  generateRecoveryCodes,
  countRemainingRecoveryCodes,
  verifyAndConsumeRecoveryCode,
} from "./recovery-codes.server";
import { recordAudit } from "./audit.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

async function assertSuperAdmin(userId: string): Promise<{ email: string | null }> {
  const { data } = await sb.from("super_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("Forbidden: super admin only");
  const u = await supabaseAdmin.auth.admin.getUserById(userId).catch(() => null);
  return { email: u?.data?.user?.email ?? null };
}

export const regenerateRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    const { email } = await assertSuperAdmin(context.userId);
    const codes = await generateRecoveryCodes(context.userId);
    await recordAudit({ actorUserId: context.userId, actorEmail: email, category: "auth", action: "recovery_codes_regenerated" });
    return { codes };
  });

export const getRecoveryCodesStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    return { remaining: await countRemainingRecoveryCodes(context.userId) };
  });

// Used on the MFA challenge screen when the authenticator device is lost:
// consumes a recovery code and removes the user TOTP factors so they can
// enrol a fresh authenticator (which then elevates the session to AAL2).
export const useRecoveryCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().trim().min(6).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const { email } = await assertSuperAdmin(context.userId);
    const ok = await verifyAndConsumeRecoveryCode(context.userId, data.code);
    if (!ok) throw new Error("Invalid or already-used recovery code.");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adminMfa = (supabaseAdmin.auth.admin as any).mfa;
      const list = await adminMfa.listFactors({ userId: context.userId });
      for (const f of list?.data?.factors ?? list?.factors ?? []) {
        await adminMfa.deleteFactor({ id: f.id, userId: context.userId }).catch(() => {});
      }
    } catch {
      // factor removal best-effort
    }
    await recordAudit({ actorUserId: context.userId, actorEmail: email, category: "auth", action: "recovery_code_used" });
    return { ok: true };
  });

export const getSuperAdminAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(500).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { data: rows } = await sb
      .from("super_admin_audit")
      .select("created_at, actor_email, category, action, detail, ip")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);
    return ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      createdAt: String(r.created_at),
      actorEmail: (r.actor_email as string | null) ?? null,
      category: String(r.category),
      action: String(r.action),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detail: (r.detail as any) ?? {},
      ip: (r.ip as string | null) ?? null,
    }));
  });
