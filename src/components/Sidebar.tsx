import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity, Map, Truck, Warehouse, ClipboardList,
  AlertTriangle, Webhook, LogOut, Shield,
} from "lucide-react";
import { useAlertCount, useUnassignedJobCount } from "@/lib/use-alerts";
import { useTenant, useFeatureFlags } from "@/lib/tenant-context";
import { signOut } from "@/lib/auth-context";
import type { TenantModule } from "@/lib/types";

const ALL_NAV: ReadonlyArray<{ to: string; label: string; icon: typeof Map; module: TenantModule | null }> = [
  { to: "/",           label: "Live Map",    icon: Map,           module: null },
  { to: "/dispatch",   label: "Dispatch",    icon: ClipboardList, module: "dispatch" },
  { to: "/jobs",       label: "Jobs",        icon: Activity,      module: "jobs" },
  { to: "/drivers",    label: "Drivers",     icon: Truck,         module: "drivers" },
  { to: "/warehouses", label: "Warehouses",  icon: Warehouse,     module: "warehouses" },
  { to: "/alerts",     label: "Alerts",      icon: AlertTriangle, module: "alerts" },
  { to: "/events",     label: "Event Log",   icon: Webhook,       module: "events" },
];

export function Sidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const alertCount = useAlertCount();
  const unassignedCount = useUnassignedJobCount();
  const { company, email, role, isSuperAdmin } = useTenant();
  const flags = useFeatureFlags();

  const visibleNav = ALL_NAV.filter(
    (n) => n.module === null || flags.modules.includes(n.module),
  );

  const displayName = flags.customBranding && flags.brandName ? flags.brandName : company.name;

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div
            className="size-7 rounded-md grid place-items-center text-primary-foreground font-mono font-bold text-sm"
            style={{
              backgroundColor: flags.customBranding && flags.brandColor
                ? flags.brandColor
                : undefined,
            }}
          >
            {!(flags.customBranding && flags.brandColor) ? (
              <span className="size-7 -m-1 rounded-md bg-primary grid place-items-center text-primary-foreground font-mono font-bold text-sm">
                {displayName.charAt(0).toUpperCase()}
              </span>
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate">{displayName}</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              UK · Dispatch v1
            </div>
          </div>
        </div>
        {company.subscription_status === "trial" && (
          <div className="mt-2 rounded px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide bg-warning/10 text-warning border border-warning/20 text-center">
            Trial
          </div>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visibleNav.map((n) => {
          const Icon = n.icon;
          const active = path === n.to;
          const badgeCount =
            n.to === "/alerts" ? alertCount
            : n.to === "/dispatch" ? unassignedCount
            : 0;
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
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 truncate">{n.label}</span>
              {badgeCount > 0 && (
                <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-mono font-bold tabular-nums animate-pulse">
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </Link>
          );
        })}

        {isSuperAdmin && (
          <>
            <div className="my-2 border-t border-border" />
            <Link
              to="/admin"
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                path.startsWith("/admin")
                  ? "bg-surface-2 text-foreground border border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-2/60"
              }`}
            >
              <Shield className="size-4 shrink-0 text-primary" />
              <span className="flex-1">Admin Panel</span>
            </Link>
          </>
        )}
      </nav>

      <div className="p-3 border-t border-border space-y-2">
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          REALTIME CONNECTED
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-muted-foreground truncate">{email}</div>
            <div className="text-[10px] font-mono uppercase text-muted-foreground/60">{role}</div>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="size-6 shrink-0 grid place-items-center rounded hover:bg-surface-2 text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
