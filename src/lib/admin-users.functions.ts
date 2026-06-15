import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { randomBytes } from "node:crypto";

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
        const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (lErr) throw new Error(lErr.message);
        const match = list.users.find((u) => u.email?.toLowerCase() === data.email);
        if (match) {
          userIdToLink = match.id;
          break;
        }
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
    if (!existingMember) {
      const { error: mErr } = await supabaseAdmin.from("company_members").insert({
        user_id: userIdToLink,
        company_id: data.companyId,
        role: "admin",
      });
      if (mErr) {
        if (created?.user) await supabaseAdmin.auth.admin.deleteUser(created.user.id);
        throw new Error(`Failed to link user to company: ${mErr.message}`);
      }
    }

    // Persist the latest password so super admins can view it later
    // (table is locked down by RLS to super admins only).
    await supabaseAdmin
      .from("admin_credentials" as never)
      .upsert(
        { user_id: userIdToLink, email: data.email, password: data.password } as never,
        { onConflict: "user_id" } as never,
      );

    return { userId: userIdToLink, email: data.email };
  });

const ListInput = z.object({ companyId: z.string().uuid() });

export const listCompanyMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ListInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanManageCompany(context.userId, data.companyId);

    const { data: members, error } = await (
      supabaseAdmin as unknown as { from: (t: string) => any }
    )
      .from("company_members")
      .select("id, user_id, role, name, must_set_password, created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const results: Array<{
      id: string;
      user_id: string;
      role: string;
      name: string | null;
      must_set_password: boolean;
      email: string | null;
      password: string | null;
      created_at: string;
    }> = [];
    for (const m of members ?? []) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
      const { data: cred } = await supabaseAdmin
        .from("admin_credentials" as never)
        .select("password")
        .eq("user_id", m.user_id)
        .maybeSingle();
      results.push({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        name: m.name ?? null,
        must_set_password: !!m.must_set_password,
        email: m.email ?? u.user?.email ?? null,
        password: (cred as { password?: string } | null)?.password ?? null,
        created_at: m.created_at,
      });
    }
    return results;
  });

// ─────────────────────────────────────────────────────────────────────────
// Per-company profiles (name-based login). Super-admin managed: create / reset
// password / delete. Associates log in with an auto-generated hidden email and
// set their own personal password on first login (must_set_password gate).
// ─────────────────────────────────────────────────────────────────────────
const sbAny = supabaseAdmin as unknown as { from: (t: string) => any };

function slugifyName(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 40) || "user"
  );
}

// One-time temp password with mixed character classes (satisfies any policy).
function genTempPassword(): string {
  return randomBytes(9).toString("base64url") + "A1!";
}

async function assertSuperAdmin(userId: string): Promise<void> {
  const { data: sa } = await supabaseAdmin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!sa) throw new Error("Forbidden: super admin only");
}

// Allows the platform super-admin OR the company's own admin (same tenant) to
// manage that company's member profiles. Enforces tenant isolation: a company
// admin can only ever act on their own company.
async function assertCanManageCompany(callerId: string, companyId: string): Promise<void> {
  const { data: sa } = await supabaseAdmin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();
  if (sa) return;
  const { data: m } = await sbAny
    .from("company_members")
    .select("role")
    .eq("user_id", callerId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (m && m.role === "admin") return;
  throw new Error("Forbidden: company admin only");
}

const CreateProfileInput = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

export const createCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateProfileInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanManageCompany(context.userId, data.companyId);

    const { data: company, error: cErr } = await supabaseAdmin
      .from("companies")
      .select("slug")
      .eq("id", data.companyId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!company) throw new Error("Company not found");
    const slug = (company as { slug: string }).slug;

    const password = genTempPassword();
    const base = slugifyName(data.name);
    const domain = `${slug}.team`;

    // Create the auth user, retrying with a random suffix on email collision.
    let email = `${base}@${domain}`;
    let userId: string | null = null;
    for (let attempt = 0; attempt < 6 && !userId; attempt++) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created?.user) {
        userId = created.user.id;
        break;
      }
      const msg = error?.message?.toLowerCase() ?? "";
      const duplicate =
        msg.includes("already") || (error as { code?: string } | null)?.code === "email_exists";
      if (!duplicate) throw new Error(error?.message ?? "Failed to create profile");
      email = `${base}.${randomBytes(2).toString("hex")}@${domain}`;
    }
    if (!userId) throw new Error("Could not allocate a unique login for that name");

    const { error: mErr } = await sbAny.from("company_members").insert({
      company_id: data.companyId,
      user_id: userId,
      role: "member",
      name: data.name,
      email,
      must_set_password: true,
    });
    if (mErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(`Failed to link profile: ${mErr.message}`);
    }

    await sbAny
      .from("admin_credentials")
      .upsert({ user_id: userId, email, password }, { onConflict: "user_id" });

    // tempPassword is returned for one-time display only; never logged.
    return { name: data.name, email, tempPassword: password };
  });

const MemberInput = z.object({ memberId: z.string().uuid() });

export const resetProfilePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => MemberInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: m } = await sbAny
      .from("company_members")
      .select("user_id, email, company_id")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!m) throw new Error("Profile not found");
    await assertCanManageCompany(context.userId, m.company_id);

    const password = genTempPassword();
    const { error: uErr } = await supabaseAdmin.auth.admin.updateUserById(m.user_id, {
      password,
      email_confirm: true,
    });
    if (uErr) throw new Error(uErr.message);

    await sbAny.from("company_members").update({ must_set_password: true }).eq("id", data.memberId);
    await sbAny
      .from("admin_credentials")
      .upsert({ user_id: m.user_id, email: m.email, password }, { onConflict: "user_id" });

    return { tempPassword: password };
  });

export const deleteProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => MemberInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: m } = await sbAny
      .from("company_members")
      .select("user_id, role, company_id")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!m) throw new Error("Profile not found");
    await assertCanManageCompany(context.userId, m.company_id);

    // Never leave a company without an admin.
    if (m.role === "admin") {
      const { count } = await sbAny
        .from("company_members")
        .select("id", { count: "exact", head: true })
        .eq("company_id", m.company_id)
        .eq("role", "admin");
      if ((count ?? 0) <= 1) throw new Error("Cannot delete the last admin of a company");
    }

    await sbAny.from("admin_credentials").delete().eq("user_id", m.user_id);
    // Deleting the auth user cascades the company_members row (FK ON DELETE CASCADE).
    const { error } = await supabaseAdmin.auth.admin.deleteUser(m.user_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

// Called by an associate after they set their own password on first login.
export const completeFirstLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await sbAny
      .from("company_members")
      .update({ must_set_password: false })
      .eq("user_id", context.userId);
    return { ok: true };
  });

// Member self-service: save own profile picture URL (uploaded to the avatars bucket).
export const setMemberAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ avatarUrl: z.string().url().max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await sbAny
      .from("company_members")
      .update({ avatar_url: data.avatarUrl })
      .eq("user_id", context.userId);
    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────────────
// Delete an entire company — cascades through members, auth users,
// admin_credentials, and all tenant-owned data (warehouses, drivers,
// jobs, driver_events, activity_log via ON DELETE CASCADE).
// ─────────────────────────────────────────────────────────────────────────
const DeleteCompanyInput = z.object({ companyId: z.string().uuid() });

export const deleteCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => DeleteCompanyInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);

    // 1. Collect all auth user IDs linked to this company so we can
    //    clean them up after the cascade deletes the member rows.
    const { data: members } = await sbAny
      .from("company_members")
      .select("user_id")
      .eq("company_id", data.companyId);

    const userIds: string[] = (members ?? []).map((m: { user_id: string }) => m.user_id);

    // 2. Delete all admin_credentials rows for these users.
    if (userIds.length > 0) {
      await sbAny.from("admin_credentials").delete().in("user_id", userIds);
    }

    // 3. Delete the company — this cascades to company_members, and
    //    all tenant-scoped tables (warehouses, drivers, jobs, events, etc.).
    const { error } = await supabaseAdmin.from("companies").delete().eq("id", data.companyId);
    if (error) throw new Error(error.message);

    // 4. Delete the auth users themselves.
    for (const uid of userIds) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
    }

    return { ok: true };
  });
