import { Link, useLocation } from "@tanstack/react-router";
import { Home, Map, AlertTriangle, User, Download, Calendar } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { useState } from "react";

const tabs = [
  { id: "home",    path: "/d",        label: "Home",    Icon: Home },
  { id: "routes",  path: "/d/routes", label: "Routes",  Icon: Map },
  { id: "shift",   path: "/d/shift",  label: "Shift",   Icon: Calendar },
  { id: "report",  path: "/d/report", label: "Report",  Icon: AlertTriangle },
  { id: "profile", path: "/d/profile",label: "Profile", Icon: User },
] as const;

export function DriverBottomNav() {
  const location = useLocation();
  const { isInstallable, isInstalled, promptInstall } = usePwaInstall();
  const [installing, setInstalling] = useState(false);
  const current = tabs.find((t) =>
    t.path === "/d"
      ? location.pathname === "/d"
      : location.pathname.startsWith(t.path),
  )?.id;

  const handleInstallClick = async () => {
    setInstalling(true);
    await promptInstall();
    setInstalling(false);
  };

  return (
    <nav className="driver-bottom-nav">
      {isInstallable && !isInstalled && (
        <button
          onClick={handleInstallClick}
          disabled={installing}
          className="driver-nav-item install-btn"
          title="Install app on your phone"
          style={{ animation: "pulse-glow 2s ease-in-out infinite" }}
        >
          <Download
            strokeWidth={2.5}
            style={{
              color: "oklch(0.62 0.22 245)",
              filter: "drop-shadow(0 0 8px oklch(0.62 0.22 245 / 0.7))",
            }}
          />
          <span style={{ fontSize: "10px", letterSpacing: "0.04em", fontWeight: 600 }}>
            {installing ? "Installing..." : "Install"}
          </span>
        </button>
      )}
      {tabs.map((t) => {
        const active = current === t.id;
        const { Icon } = t;
        return (
          <Link
            key={t.id}
            to={t.path}
            className={`driver-nav-item${active ? " active" : ""}`}
          >
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
      <style>{`
        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .install-btn { cursor: pointer; transition: all 0.2s ease; }
        .install-btn:hover:not(:disabled) { transform: scale(1.05); }
        .install-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>
    </nav>
  );
}
