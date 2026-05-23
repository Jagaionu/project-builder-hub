import { createFileRoute, Outlet, redirect, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_admin")({
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/login" });

    const { data: superAdmin } = await supabase
      .from("super_admins" as never)
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (!superAdmin) {
      throw redirect({ to: "/" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-3">
        <div className="size-6 rounded bg-primary grid place-items-center text-primary-foreground font-mono text-xs font-bold">A</div>
        <span className="text-sm font-semibold">Super Admin</span>
        <span className="text-xs text-muted-foreground font-mono">— Full platform control</span>
        <div className="ml-auto">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Back to app
          </Link>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
