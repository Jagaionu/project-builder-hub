import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Sidebar } from "@/components/Sidebar";
import { AiHighlightListener } from "@/lib/ai-highlight";
import { TenantProvider } from "@/lib/tenant-context";
import { supabase } from "@/integrations/supabase/client";
import { completeFirstLogin } from "@/lib/admin-users.functions";
import type { AuthContext, Company, MemberRole } from "@/lib/types";

export const Route = createFileRoute("/_app")({
  ssr: false,
  // ── AUTH & SUBSCRIPTION GATE ──────────────────────────────────────────────
  beforeLoad: async ({ location }): Promise<AuthContext> => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session) {
      const claimed =
        typeof window !== "undefined" ? localStorage.getItem("device.companyId") : null;
      throw redirect(
        claimed ? { to: "/lock" } : { to: "/login", search: { redirect: location.href } },
      );
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
      .select("role, company_id, name, must_set_password, avatar_url")
      .eq("user_id", session.user.id)
      .maybeSingle<{
        role: string;
        company_id: string;
        name: string | null;
        must_set_password: boolean | null;
        avatar_url: string | null;
      }>();

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

    if (
      company.subscription_status === "suspended" ||
      company.subscription_status === "cancelled"
    ) {
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
      name: memberRow.name ?? null,
      mustSetPassword: !!memberRow.must_set_password,
      avatarUrl: memberRow.avatar_url ?? null,
    };
  },
  component: AppLayout,
});

function AppLayout() {
  const authCtx = Route.useRouteContext() as unknown as AuthContext;
  if (authCtx.mustSetPassword) {
    return <SetPasswordGate />;
  }
  return (
    <TenantProvider value={authCtx}>
      <AiHighlightListener />
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </TenantProvider>
  );
}

// First-login gate: associates created with a one-time password must set their
// own personal password before using the app. Clears must_set_password.
function SetPasswordGate() {
  const complete = useServerFn(completeFirstLogin);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
      await complete({});
      toast.success("Password set");
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't set password");
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 space-y-4"
      >
        <div>
          <h1 className="text-lg font-semibold">Set your password</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Choose a personal password to finish setting up your profile.
          </p>
        </div>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="New password"
          autoFocus
          className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Saving…" : "Set password & continue"}
        </button>
      </form>
    </div>
  );
}
