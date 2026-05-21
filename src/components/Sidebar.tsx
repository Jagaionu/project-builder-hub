import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Map, Truck, Warehouse, ClipboardList, AlertTriangle, Webhook } from "lucide-react";
import { useAlertCount } from "@/lib/use-alerts";

const nav = [
  { to: "/", label: "Live Map", icon: Map },
  { to: "/dispatch", label: "Dispatch", icon: ClipboardList },
  { to: "/jobs", label: "Jobs", icon: Activity },
  { to: "/drivers", label: "Drivers", icon: Truck },
  { to: "/warehouses", label: "Warehouses", icon: Warehouse },
  { to: "/alerts", label: "Alerts", icon: AlertTriangle },
  { to: "/events", label: "Event Log", icon: Webhook },
] as const;

export function Sidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const alertCount = useAlertCount();
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-md bg-primary grid place-items-center text-primary-foreground font-mono font-bold text-sm">P</div>
          <div>
            <div className="text-sm font-semibold tracking-tight">Planning System</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">UK · Dispatch v1</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {nav.map((n) => {
          const Icon = n.icon;
          const active = path === n.to;
          const showBadge = n.to === "/alerts" && alertCount > 0;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "bg-surface-2 text-foreground border border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-2/60"
              }`}
            >
              <Icon className="size-4" />
              <span className="flex-1">{n.label}</span>
              {showBadge && (
                <span
                  className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-mono font-bold tabular-nums animate-pulse"
                  aria-label={`${alertCount} active alerts`}
                >
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          REALTIME CONNECTED
        </div>
      </div>
    </aside>
  );
}
