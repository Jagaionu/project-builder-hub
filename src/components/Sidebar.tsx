import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity, Map, Truck, Warehouse, ClipboardList,
  AlertTriangle, Webhook, LogOut, Shield, Radio,
} from "lucide-react";
import { useAlertCount, useUnassignedJobCount } from "@/lib/use-alerts";
import { useTenant, useFeatureFlags } from "@/lib/tenant-context";
import { signOut } from "@/lib/auth-context";
import type { TenantModule } from "@/lib/types";

const ALL_NAV: ReadonlyArray<{
  to: string;
  label: string;
  icon: typeof Map;
  module: TenantModule | null;
}> = [
  { to: "/",           label: "Live Map",   icon: Map,           module: null },
  { to: "/dispatch",   label: "Dispatch",   icon: ClipboardList, module: "dispatch" },
  { to: "/drivers",    label: "Drivers",    icon: Truck,         module: "drivers" },
  { to: "/warehouses", label: "Warehouses", icon: Warehouse,     module: "warehouses" },
  { to: "/alerts",     label: "Alerts",     icon: AlertTriangle, module: "alerts" },
  { to: "/events",     label: "Event Log",  icon: Webhook,       module: "events" },
];

export function Sidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const alertCount      = useAlertCount();
  const unassignedCount = useUnassignedJobCount();
  const { company, email, role, isSuperAdmin } = useTenant();
  const flags = useFeatureFlags();

  const visibleNav = ALL_NAV.filter(
    (n) => n.module === null || flags.modules.includes(n.module),
  );

  const displayName =
    flags.customBranding && flags.brandName ? flags.brandName : company.name;

  return (
    <aside
      className="w-56 shrink-0 flex flex-col"
      style={{
        background: "linear-gradient(180deg, oklch(0.15 0.018 245) 0%, oklch(0.13 0.016 245) 100%)",
        borderRight: "1px solid oklch(0.22 0.018 245)",
      }}
    >
      {/* ── Brand header ── */}
      <div className="px-4 pt-5 pb-4" style={{ borderBottom: "1px solid oklch(0.20 0.016 245)" }}>
        <div className="flex items-center gap-2.5">
          <div
            className="size-8 rounded-lg grid place-items-center font-mono font-bold text-sm text-primary-foreground shrink-0"
            style={{
              background: flags.customBranding && flags.brandColor
                ? flags.brandColor
                : "linear-gradient(135deg, oklch(0.62 0.22 245), oklch(0.55 0.20 260))",
              boxShadow: "0 2px 8px oklch(0.62 0.22 245 / 0.35)",
            }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate leading-tight">
              {displayName}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-0.5">
              UK · Dispatch
            </div>
          </div>
        </div>

        {company.subscription_status === "trial" && (
          <div className="mt-3 rounded-md px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-center"
            style={{
              background: "oklch(0.80 0.18 72 / 0.08)",
              border: "1px solid oklch(0.80 0.18 72 / 0.25)",
              color: "oklch(0.80 0.18 72)",
            }}
          >
            Trial period
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visibleNav.map((n) => {
          const Icon = n.icon;
          const active = path === n.to;
          const badgeCount =
            n.to === "/alerts"   ? alertCount :
            n.to === "/dispatch" ? unassignedCount : 0;

          return (
            <Link
              key={n.to}
              to={n.to}
              className="nav-item"
              style={active ? {
                color: "oklch(0.75 0.18 245)",
                background: "oklch(0.62 0.22 245 / 0.12)",
                borderLeft: "2px solid oklch(0.62 0.22 245)",
                paddingLeft: "calc(0.75rem - 2px)",
              } : {}}
            >
              <Icon
                className="size-4 shrink-0"
                style={{ color: active ? "oklch(0.62 0.22 245)" : undefined }}
              />
              <span className="flex-1 truncate">{n.label}</span>
              {badgeCount > 0 && (
                <span
                  className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full font-mono font-bold text-[10px] tabular-nums"
                  style={{
                    background: n.to === "/alerts"
                      ? "oklch(0.63 0.22 20 / 0.9)"
                      : "oklch(0.62 0.22 245 / 0.9)",
                    color: "oklch(0.98 0.004 240)",
                    boxShadow: n.to === "/alerts"
                      ? "0 0 6px oklch(0.63 0.22 20 / 0.4)"
                      : "0 0 6px oklch(0.62 0.22 245 / 0.4)",
                  }}
                >
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </Link>
          );
        })}

        {isSuperAdmin && (
          <>
            <div className="my-2 mx-1" style={{ height: 1, background: "oklch(0.20 0.016 245)" }} />
            <Link
              to="/admin"
              className="nav-item"
              style={path.startsWith("/admin") ? {
                color: "oklch(0.75 0.18 245)",
                background: "oklch(0.62 0.22 245 / 0.12)",
                borderLeft: "2px solid oklch(0.62 0.22 245)",
                paddingLeft: "calc(0.75rem - 2px)",
              } : {}}
            >
              <Shield className="size-4 shrink-0" style={{ color: "oklch(0.62 0.22 245)" }} />
              <span className="flex-1">Admin Panel</span>
            </Link>
          </>
        )}
      </nav>

      {/* ── Footer ── */}
      <div
        className="px-3 py-3 space-y-2.5"
        style={{ borderTop: "1px solid oklch(0.20 0.016 245)" }}
      >
        {/* Realtime indicator */}
        <div className="flex items-center gap-2">
          <Radio className="size-3 text-success" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Realtime live
          </span>
          <span
            className="size-1.5 rounded-full bg-success ml-auto"
            style={{ boxShadow: "0 0 4px oklch(0.73 0.17 150 / 0.7)", animation: "pulse 2s ease infinite" }}
          />
        </div>

        {/* User row */}
        <div
          className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors"
          style={{ background: "oklch(0.17 0.018 245)" }}
        >
          {/* Avatar */}
          <div
            className="size-6 rounded-md grid place-items-center shrink-0 text-[10px] font-mono font-bold"
            style={{
              background: "oklch(0.22 0.020 245)",
              color: "oklch(0.65 0.016 245)",
              border: "1px solid oklch(0.26 0.018 245)",
            }}
          >
            {email.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-muted-foreground truncate leading-tight">{email}</div>
            <div className="text-[9px] font-mono uppercase tracking-widest mt-0.5"
              style={{ color: "oklch(0.45 0.012 245)" }}>
              {role}
            </div>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="size-6 shrink-0 grid place-items-center rounded-md transition-colors"
            style={{ color: "oklch(0.45 0.012 245)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "oklch(0.63 0.22 20)")}
            onMouseLeave={e => (e.currentTarget.style.color = "oklch(0.45 0.012 245)")}
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
