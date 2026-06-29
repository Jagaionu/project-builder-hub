// Device binding for office logins (anti credential-sharing, phase 2).
// A login auto-approves up to DEVICE_CAP devices; further devices are held
// PENDING until the platform super admin approves them. All access runs through
// the service role here (the table is RLS-locked to service-role only), guarded
// by explicit checks below.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequest } from "@tanstack/react-start/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

// Devices auto-approved per login before a new one must be approved. A real
// person uses ~1-2 devices (laptop + phone); beyond that looks like sharing.
const DEVICE_CAP = 2;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Best-effort coarse geo at login (from Vercel edge headers) + impossible-travel
// flag. Never throws into the login path.
async function recordLoginGeo(userId: string, companyId: string | null, deviceId: string) {
  try {
    const req = getRequest();
    const h = req?.headers;
    if (!h) return;
    const ip =
      (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
    const country = h.get("x-vercel-ip-country");
    const cityRaw = h.get("x-vercel-ip-city");
    const latS = h.get("x-vercel-ip-latitude");
    const lonS = h.get("x-vercel-ip-longitude");
    const lat = latS ? Number(latS) : null;
    const lon = lonS ? Number(lonS) : null;
    let city: string | null = null;
    try {
      city = cityRaw ? decodeURIComponent(cityRaw) : null;
    } catch {
      city = cityRaw ?? null;
    }

    let suspicious = false;
    let reason: string | null = null;
    if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
      const { data: prev } = await sb
        .from("user_login_events")
        .select("lat, lon, created_at")
        .eq("user_id", userId)
        .not("lat", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prev?.lat != null && prev?.lon != null) {
        const km = haversineKm(prev.lat, prev.lon, lat, lon);
        const hrs = Math.max((Date.now() - new Date(prev.created_at).getTime()) / 3600000, 1 / 60);
        const speed = km / hrs;
        if (km > 100 && speed > 900) {
          suspicious = true;
          reason = "Impossible travel: " + Math.round(km) + " km in " + hrs.toFixed(1) + " h";
        }
      }
    }
    await sb.from("user_login_events").insert({
      user_id: userId,
      company_id: companyId,
      device_id: deviceId,
      ip,
      country: country ?? null,
      city,
      lat,
      lon,
      suspicious,
      reason,
    });
  } catch {
    /* best-effort: geo/anomaly capture must never block a login */
  }
}

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
    await recordLoginGeo(context.userId, companyId, data.deviceId);

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

export const listSuspiciousLogins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    if (!(await isSuper(context.userId))) throw new Error("Forbidden: super admin only");
    const { data: events } = await sb
      .from("user_login_events")
      .select("id, user_id, company_id, ip, country, city, reason, created_at")
      .eq("suspicious", true)
      .order("created_at", { ascending: false })
      .limit(100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (events ?? []) as Array<any>;
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
      when: r.created_at as string,
      reason: (r.reason ?? null) as string | null,
      ip: (r.ip ?? null) as string | null,
      place: [r.city, r.country].filter(Boolean).join(", ") || "Unknown",
      companyName: r.company_id ? ((compName.get(r.company_id) as string) ?? "—") : "—",
      who:
        ((memMap.get(r.user_id) as { name?: string | null; email?: string | null } | undefined)
          ?.name ??
          (memMap.get(r.user_id) as { email?: string | null } | undefined)?.email ??
          "—") as string,
    }));
  });
