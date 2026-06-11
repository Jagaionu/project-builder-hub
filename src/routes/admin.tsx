import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin")({
  ssr: false,
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
        <span className="text-xs text-muted-foreground font-mono hidden sm:inline">— Full platform control</span>
        <div className="ml-auto">
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/login";
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to login
          </button>
        </div>
      </header>
      <div className="px-4 sm:px-6 lg:px-8 py-4 max-w-[1440px] mx-auto">
        <Outlet />
      </div>
    </div>
  );
}
