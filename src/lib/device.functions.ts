// Device binding for office logins (anti credential-sharing, phase 2).
// A login auto-approves up to DEVICE_CAP devices; further devices are held
// PENDING until the platform super admin approves them. All access runs through
// the service role here (the table is RLS-locked to service-role only), guarded
// by explicit checks below.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

// Devices auto-approved per login before a new one must be approved. A real
// person uses ~1-2 devices (laptop + phone); beyond that looks like sharing.
const DEVICE_CAP = 2;

async function isSuper(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export const registerDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ deviceId: z.string().min(8).max(128), label: z.string().max(200).optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const nowIso = new Date().toISOString();
    const { data: member } = await sb
      .from("company_members")
      .select("company_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const companyId = member?.company_id ?? null;

    const { data: existing } = await sb
      .from("user_devices")
      .select("id, status")
      .eq("user_id", context.userId)
      .eq("device_id", data.deviceId)
      .maybeSingle();
    if (existing) {
      await sb
        .from("user_devices")
        .update({ last_seen: nowIso, label: data.label ?? null })
        .eq("id", existing.id);
      return { status: existing.status as string };
    }

    // New device: auto-approve up to the cap, otherwise require approval.
    const { count } = await sb
      .from("user_devices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "approved");
    const status = (count ?? 0) < DEVICE_CAP ? "approved" : "pending";
    await sb.from("user_devices").insert({
      user_id: context.userId,
      company_id: companyId,
      device_id: data.deviceId,
      label: data.label ?? null,
      status,
      first_seen: nowIso,
      last_seen: nowIso,
      approved_at: status === "approved" ? nowIso : null,
    });
    return { status };
  });

export const listDevicesForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    if (!(await isSuper(context.userId))) throw new Error("Forbidden: super admin only");
    const { data: devices } = await sb
      .from("user_devices")
      .select("id, user_id, company_id, device_id, label, status, first_seen, last_seen")
      .order("first_seen", { ascending: false })
      .limit(300);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (devices ?? []) as Array<any>;
    const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))];
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: comps } = companyIds.length
      ? await sb.from("companies").select("id, name").in("id", companyIds)
      : { data: [] };
    const { data: mems } = userIds.length
      ? await sb.from("company_members").select("user_id, name, email").in("user_id", userIds)
      : { data: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compName = new Map((comps ?? []).map((c: any) => [c.id, c.name]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memMap = new Map((mems ?? []).map((m: any) => [m.user_id, m]));
    return rows.map((r) => ({
      id: r.id as string,
      status: r.status as string,
      label: (r.label ?? null) as string | null,
      deviceId: r.device_id as string,
      firstSeen: r.first_seen as string,
      lastSeen: r.last_seen as string,
      companyName: r.company_id ? ((compName.get(r.company_id) as string) ?? "—") : "—",
      memberName: ((memMap.get(r.user_id) as { name?: string | null } | undefined)?.name ??
        null) as string | null,
      email: ((memMap.get(r.user_id) as { email?: string | null } | undefined)?.email ??
        null) as string | null,
    }));
  });

export const setDeviceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["approved", "revoked"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isSuper(context.userId))) throw new Error("Forbidden: super admin only");
    await sb
      .from("user_devices")
      .update({
        status: data.status,
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    return { ok: true };
  });
