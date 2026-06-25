import { createFileRoute, Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DriverBottomNav } from "@/components/driver/DriverBottomNav";
import { PwaInstallPrompt } from "@/components/driver/PwaInstallPrompt";
import { useDriverBootstrap } from "@/hooks/useDriverBootstrap";
import { DriverNotificationBell } from "@/components/driver/DriverNotificationBell";
import { useDriverStore } from "@/lib/driver-store";
import { driverLogout } from "@/lib/driver-auth";
import { DriverTachographModal } from "@/components/driver/DriverTachographModal";
import { Ban, UserX } from "lucide-react";

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
  const accountStatus = useDriverStore((s) => s.accountStatus);
  const suspendedUntil = useDriverStore((s) => s.suspendedUntil);
  const suspendedReason = useDriverStore((s) => s.suspendedReason);
  const authResolved = useDriverStore((s) => s.authResolved);
  const isLogin = location.pathname === "/d/login";

  useEffect(() => {
    // Wait until the initial Supabase session check has finished before
    // redirecting — otherwise the login screen flashes for signed-in drivers.
    if (!authResolved) return;
    const s = useDriverStore.getState().session;
    if (!s && !isLogin) router.navigate({ to: "/d/login" });
    else if (s && isLogin) router.navigate({ to: "/d" });
  }, [authResolved, session, isLogin, router]);

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

  // Until the session check resolves, show a neutral splash rather than the
  // login screen — this removes the "enter code" flash for signed-in drivers.
  if (!authResolved) {
    return (
      <div className="min-h-screen bg-background driver-app flex items-center justify-center">
        <div className="size-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  // Block access for suspended / deleted accounts (only once signed in).
  // Placed after all hooks to respect the rules of hooks.
  if (!isLogin && session && accountStatus !== "active") {
    if (accountStatus === "suspended") {
      return <SuspendedScreen until={suspendedUntil} reason={suspendedReason} />;
    }
    return (
      <DeletedScreen
        onUseNewCode={async () => {
          await driverLogout();
          useDriverStore.getState().reset();
          router.navigate({ to: "/d/login" });
        }}
      />
    );
  }

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
      {!isLogin && session && <DriverNotificationBell />}
      {!isLogin && session && <DriverBottomNav />}
      {!isLogin && <PwaInstallPrompt />}
      {!isLogin && session && <DriverTachographModal />}
    </div>
  );
}

function SuspendedScreen({ until, reason }: { until: string | null; reason: string | null }) {
  const untilLabel = until
    ? new Date(until).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
    : null;
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-5">
        <Ban className="size-9 text-amber-500" />
      </div>
      <h1 className="text-2xl font-bold text-foreground">Account suspended</h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm">
        Your driver account is currently suspended{untilLabel ? ` until ${untilLabel}` : ""}, so the
        app is unavailable. Please contact your dispatcher for details.
      </p>
      {reason && (
        <div className="mt-4 w-full max-w-sm rounded-xl border border-border bg-card px-4 py-3 text-left">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            Reason
          </div>
          <p className="text-sm text-foreground">{reason}</p>
        </div>
      )}
    </div>
  );
}

function DeletedScreen({ onUseNewCode }: { onUseNewCode: () => void }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div className="w-20 h-20 rounded-2xl bg-destructive/10 border border-destructive/30 flex items-center justify-center mb-5">
        <UserX className="size-9 text-destructive" />
      </div>
      <h1 className="text-2xl font-bold text-foreground">Account removed</h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm">
        This driver account has been removed from the system, so the app is no longer available. If
        you've been given a new code, you can sign in with it below.
      </p>
      <button
        onClick={onUseNewCode}
        className="mt-6 w-full max-w-sm bg-primary text-primary-foreground font-semibold rounded-xl py-4 active:scale-[0.99] transition"
      >
        Use a different code
      </button>
    </div>
  );
}
