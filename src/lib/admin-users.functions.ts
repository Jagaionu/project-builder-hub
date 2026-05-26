import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Input = z.object({
  companyId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(128),
});

export const createCompanyAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Verify caller is a super admin
    const { data: sa } = await supabaseAdmin
      .from("super_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!sa) throw new Error("Forbidden: super admin only");

    // Verify company exists
    const { data: company, error: cErr } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("id", data.companyId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!company) throw new Error("Company not found");

    // Try to create the auth user (email auto-confirmed).
    // If the email is already registered, reuse the existing user.
    let userIdToLink: string | null = null;
    const { data: created, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (created?.user) {
      userIdToLink = created.user.id;
    } else if (uErr) {
      const msg = uErr.message?.toLowerCase() ?? "";
      const isDuplicate =
        msg.includes("already been registered") ||
        msg.includes("already registered") ||
        msg.includes("already exists") ||
        (uErr as { code?: string }).code === "email_exists";
      if (!isDuplicate) throw new Error(uErr.message);

      // Find the existing user by email (paginate auth.users list).
      let page = 1;
      const perPage = 200;
      while (!userIdToLink) {
        const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (lErr) throw new Error(lErr.message);
        const match = list.users.find((u) => u.email?.toLowerCase() === data.email);
        if (match) { userIdToLink = match.id; break; }
        if (list.users.length < perPage) break;
        page += 1;
      }
      if (!userIdToLink) throw new Error("Email already registered but user lookup failed");

      // User already existed — update their password to the newly generated one
      // so the credentials shown to the super admin actually work.
      const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(userIdToLink, {
        password: data.password,
        email_confirm: true,
      });
      if (pwErr) throw new Error(`Failed to update password: ${pwErr.message}`);
    } else {
      throw new Error("Failed to create user");
    }

    // Check if already a member of this company
    const { data: existingMember } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("user_id", userIdToLink)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (existingMember) {
      return { userId: userIdToLink, email: data.email };
    }

    // Link to company as admin
    const { error: mErr } = await supabaseAdmin.from("company_members").insert({
      user_id: userIdToLink,
      company_id: data.companyId,
      role: "admin",
    });
    if (mErr) {
      // Only roll back if we just created the user
      if (created?.user) {
        await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      }
      throw new Error(`Failed to link user to company: ${mErr.message}`);
    }

    // Note: we intentionally do NOT persist the password — Supabase Auth is
    // the source of truth. If an admin forgets their password, super admins
    // can issue a reset via the auth admin API.

    return { userId: userIdToLink, email: data.email };
  });

const ListInput = z.object({ companyId: z.string().uuid() });

export const listCompanyMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ListInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: sa } = await supabaseAdmin
      .from("super_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!sa) throw new Error("Forbidden");

    const { data: members, error } = await supabaseAdmin
      .from("company_members")
      .select("id, user_id, role, created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const results: Array<{ id: string; user_id: string; role: string; email: string | null; password: string | null; created_at: string }> = [];
    for (const m of members ?? []) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
      results.push({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        email: u.user?.email ?? null,
        password: null,
        created_at: m.created_at,
      });
    }
    return results;
  });
