import { Link, useLocation } from "@tanstack/react-router";

const tabs = [
  { id: "home", path: "/d", label: "Home", icon: "🏠" },
  { id: "routes", path: "/d/routes", label: "Routes", icon: "📋" },
  { id: "report", path: "/d/report", label: "Report", icon: "⚠️" },
  { id: "profile", path: "/d/profile", label: "Me", icon: "👤" },
] as const;

export function DriverBottomNav() {
  const location = useLocation();
  const current = tabs.find((t) =>
    t.path === "/d" ? location.pathname === "/d" : location.pathname.startsWith(t.path),
  )?.id;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-stretch h-16 max-w-md mx-auto">
        {tabs.map((t) => {
          const active = current === t.id;
          return (
            <Link
              key={t.id}
              to={t.path}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <span className="text-xl leading-none">{t.icon}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
