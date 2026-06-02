import { createFileRoute, Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DriverBottomNav } from "@/components/driver/DriverBottomNav";
import { PwaInstallPrompt } from "@/components/driver/PwaInstallPrompt";
import { useDriverBootstrap } from "@/hooks/useDriverBootstrap";
import { useDriverStore } from "@/lib/driver-store";

export const Route = createFileRoute("/d")({
  head: () => ({ meta: [{ title: "Driver Hub" }] }),
  component: DriverLayout,
});

const SWIPE_TABS = ["/d", "/d/report", "/d/profile"] as const;
type SwipeTab = (typeof SWIPE_TABS)[number];

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

  // ── Swipe navigation between top-level driver tabs ────────────────────
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const swipeBlocked = useRef(false);
  const [swipeHint, setSwipeHint] = useState<"left" | "right" | null>(null);

  const currentTabIndex = SWIPE_TABS.findIndex((p) =>
    p === "/d" ? location.pathname === "/d" : location.pathname.startsWith(p),
  );
  const swipeEligible = !isLogin && !!session && currentTabIndex !== -1;

  const onTouchStart = (e: React.TouchEvent) => {
    if (!swipeEligible || e.touches.length !== 1) return;
    // Ignore swipes that start on horizontally scrollable elements (maps, carousels, sliders)
    const target = e.target as HTMLElement | null;
    swipeBlocked.current = !!target?.closest(
      "[data-no-swipe], .leaflet-container, input[type='range'], [role='slider']",
    );
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || swipeBlocked.current || !swipeEligible) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    // Require a fast, mostly-horizontal swipe of meaningful distance
    if (absX < 60 || absX < absY * 1.5 || dt > 600) return;

    const direction = dx < 0 ? 1 : -1; // swipe left → next tab
    const nextIndex = currentTabIndex + direction;
    if (nextIndex < 0 || nextIndex >= SWIPE_TABS.length) return;

    setSwipeHint(direction === 1 ? "left" : "right");
    setTimeout(() => setSwipeHint(null), 220);
    router.navigate({ to: SWIPE_TABS[nextIndex] as SwipeTab });
  };

  return (
    <div className="min-h-screen bg-background driver-app">
      <main
        className={isLogin ? "" : "pb-20 max-w-md mx-auto"}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          touchAction: "pan-y",
          transition: "transform 180ms ease, opacity 180ms ease",
          transform:
            swipeHint === "left"
              ? "translateX(-12px)"
              : swipeHint === "right"
                ? "translateX(12px)"
                : "translateX(0)",
          opacity: swipeHint ? 0.85 : 1,
        }}
      >
        <Outlet />
      </main>
      {!isLogin && session && <DriverBottomNav />}
      {!isLogin && <PwaInstallPrompt />}
    </div>
  );
}
