import { Link, useLocation } from "@tanstack/react-router";
import { Home, Map, AlertTriangle, User } from "lucide-react";

const tabs = [
  { id: "home",   path: "/d",        label: "Home",    Icon: Home },
  { id: "routes", path: "/d/routes", label: "Routes",  Icon: Map },
  { id: "report", path: "/d/report", label: "Report",  Icon: AlertTriangle },
  { id: "profile",path: "/d/profile",label: "Profile", Icon: User },
] as const;

export function DriverBottomNav() {
  const location = useLocation();
  const current = tabs.find((t) =>
    t.path === "/d"
      ? location.pathname === "/d"
      : location.pathname.startsWith(t.path),
  )?.id;

  return (
    <nav className="driver-bottom-nav">
      {tabs.map((t) => {
        const active = current === t.id;
        const { Icon } = t;
        return (
          <Link
            key={t.id}
            to={t.path}
            className={`driver-nav-item${active ? " active" : ""}`}
          >
            {/* Active indicator dot */}
            {active && (
              <span
                className="absolute top-1.5 left-1/2 -translate-x-1/2 size-1 rounded-full"
                style={{ background: "oklch(0.62 0.22 245)" }}
              />
            )}
            <Icon
              strokeWidth={active ? 2.5 : 1.8}
              style={{
                color: active ? "oklch(0.62 0.22 245)" : undefined,
                filter: active ? "drop-shadow(0 0 6px oklch(0.62 0.22 245 / 0.5))" : undefined,
              }}
            />
            <span style={{ fontSize: "10px", letterSpacing: "0.04em", fontWeight: active ? 600 : 500 }}>
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
