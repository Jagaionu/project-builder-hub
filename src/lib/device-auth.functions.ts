import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as unknown as { from: (t: string) => any };

// PUBLIC (pre-login). Lists a claimed device's working profiles (role=member)
// by name + avatar only — emails are never exposed to the browser. companyId is
// the device claim, stored locally after a manager signs in with the company login.
export const listDeviceProfiles = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<Array<{ memberId: string; name: string; avatarUrl: string | null }>> => {
    const { data: rows } = await sb
      .from("company_members")
      .select("id, name, avatar_url")
      .eq("company_id", data.companyId)
      .eq("role", "member")
      .order("name", { ascending: true });
    return ((rows ?? []) as Array<{ id: string; name: string | null; avatar_url: string | null }>)
      .filter((m) => m.name)
      .map((m) => ({ memberId: m.id, name: m.name as string, avatarUrl: m.avatar_url ?? null }));
  });

// PUBLIC (pre-login). Verifies a profile's password server-side and returns the
// session tokens for the browser to adopt via supabase.auth.setSession(). The
// member's email stays on the server. Only role=member profiles can sign in here.
export const profileSignIn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ memberId: z.string().uuid(), password: z.string().min(1).max(128) }).parse(d),
  )
  .handler(async ({ data }): Promise<{ access_token: string; refresh_token: string }> => {
    const { data: m } = await sb
      .from("company_members")
      .select("email, role")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!m || m.role !== "member" || !m.email) throw new Error("Profile not found");

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anonKey) throw new Error("Auth not configured");

    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signed, error } = await anon.auth.signInWithPassword({ email: m.email, password: data.password });
    if (error || !signed.session) throw new Error("Incorrect password");
    return { access_token: signed.session.access_token, refresh_token: signed.session.refresh_token };
  });
