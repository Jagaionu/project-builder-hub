import { createFileRoute, Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { DriverBottomNav } from "@/components/driver/DriverBottomNav";
import { useDriverBootstrap } from "@/hooks/useDriverBootstrap";
import { useDriverStore } from "@/lib/driver-store";

export const Route = createFileRoute("/d")({
  head: () => ({ meta: [{ title: "Driver App" }] }),
  component: DriverLayout,
});

function DriverLayout() {
  useDriverBootstrap();
  const router = useRouter();
  const location = useLocation();
  const session = useDriverStore((s) => s.session);
  const isLogin = location.pathname === "/d/login";

  useEffect(() => {
    const id = setTimeout(() => {
      const s = useDriverStore.getState().session;
      if (!s && !isLogin) router.navigate({ to: "/d/login" });
      if (s && isLogin) router.navigate({ to: "/d" });
    }, 300);
    return () => clearTimeout(id);
  }, [session, isLogin, router]);

  return (
    <div className="min-h-screen bg-background dark">
      <main className={isLogin ? "" : "pb-20 max-w-md mx-auto"}>
        <Outlet />
      </main>
      {!isLogin && session && <DriverBottomNav />}
    </div>
  );
}
