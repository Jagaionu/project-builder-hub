import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { TenantProvider } from "@/lib/tenant-context";
import { supabase } from "@/integrations/supabase/client";
import type { AuthContext, Company, MemberRole } from "@/lib/types";

export const Route = createFileRoute("/_app")({
  ssr: false,
  // ── AUTH & SUBSCRIPTION GATE ──────────────────────────────────────────────
  beforeLoad: async ({ location }): Promise<AuthContext> => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }

    // Super admins don't belong to a company — send them to the admin console
    // instead of signing them out for missing company_members.
    const { data: superAdminEarly } = await supabase
      .from("super_admins" as never)
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (superAdminEarly) {
      throw redirect({ to: "/admin" });
    }

    const { data: memberRow, error: memberError } = await supabase
      .from("company_members" as never)
      .select("role, company_id")
      .eq("user_id", session.user.id)
      .maybeSingle<{ role: string; company_id: string }>();

    if (memberError || !memberRow) {
      await supabase.auth.signOut();
      throw redirect({ to: "/login", search: { error: "no_company" } });
    }

    const { data: company, error: companyError } = await supabase
      .from("companies" as never)
      .select("*")
      .eq("id", memberRow.company_id)
      .maybeSingle<Company>();

    if (companyError || !company) {
      await supabase.auth.signOut();
      throw redirect({ to: "/login", search: { error: "company_not_found" } });
    }

    if (company.subscription_status === "suspended" || company.subscription_status === "cancelled") {
      throw redirect({ to: "/suspended" });
    }
    if (
      company.subscription_status === "trial" &&
      company.subscription_ends_at &&
      new Date(company.subscription_ends_at) < new Date()
    ) {
      throw redirect({ to: "/suspended" });
    }

    const { data: superAdminRow } = await supabase
      .from("super_admins" as never)
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    return {
      userId: session.user.id,
      email: session.user.email ?? "",
      company,
      role: memberRow.role as MemberRole,
      isSuperAdmin: !!superAdminRow,
    };
  },
  component: AppLayout,
});

function AppLayout() {
  const authCtx = Route.useRouteContext() as unknown as AuthContext;
  return (
    <TenantProvider value={authCtx}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </TenantProvider>
  );
}
