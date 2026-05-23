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

    // Create the auth user (email auto-confirmed)
    const { data: created, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (uErr || !created.user) {
      throw new Error(uErr?.message ?? "Failed to create user");
    }

    // Link to company as admin
    const { error: mErr } = await supabaseAdmin.from("company_members").insert({
      user_id: created.user.id,
      company_id: data.companyId,
      role: "admin",
    });
    if (mErr) {
      // Roll back the user to avoid orphans
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(`Failed to link user to company: ${mErr.message}`);
    }

    return { userId: created.user.id, email: data.email };
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

    // Look up emails
    const results: Array<{ id: string; user_id: string; role: string; email: string | null; created_at: string }> = [];
    for (const m of members ?? []) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
      results.push({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        email: u.user?.email ?? null,
        created_at: m.created_at,
      });
    }
    return results;
  });
