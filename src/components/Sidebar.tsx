import { Link, useRouterState } from "@tanstack/react-router";
import {
  Map, Truck, Warehouse, ClipboardList,
  AlertTriangle, LogOut, Shield, Users, ScrollText,
} from "lucide-react";
import { useAlertCount, useUnassignedJobCount } from "@/lib/use-alerts";
import { useTenant, useFeatureFlags } from "@/lib/tenant-context";
import { signOut } from "@/lib/auth-context";
import type { TenantModule } from "@/lib/types";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AutoRefreshButton } from "@/components/dispatch/toolbar";
import { AIChatWidget } from "@/components/ai/ChatWidget";
import { usePendingTacho } from "@/lib/use-pending-tacho";
import { useTheme } from "@/lib/theme-context";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { setMemberAvatar } from "@/lib/admin-users.functions";
import brandLogo from "@/assets/brand-logo.png";

const ALL_NAV: ReadonlyArray<{
  to: string;
  label: string;
  icon: typeof Map;
  module: TenantModule | null;
}> = [
  { to: "/",           label: "Live Map",   icon: Map,           module: "maps" },
  { to: "/dispatch",   label: "Dispatch",   icon: Truck,         module: "dispatch" },
  { to: "/drivers",    label: "Drivers",    icon: Users,         module: "drivers" },
  { to: "/warehouses", label: "Warehouses", icon: Warehouse,     module: "warehouses" },
  { to: "/alerts",     label: "Alerts",     icon: AlertTriangle, module: "alerts" },
  { to: "/events",     label: "Events",     icon: ScrollText,    module: "events" },
];

export function Sidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const alertCount      = useAlertCount();
  const unassignedCount = useUnassignedJobCount();
  const { driverCount: pendingTachoCount } = usePendingTacho();
  const { company, email, role, isSuperAdmin, name, userId, avatarUrl } = useTenant();
  const flags = useFeatureFlags();
  const { cycleAccent, accentColor } = useTheme();

  const visibleNav = ALL_NAV.filter(
    (n) => n.module === null || flags.modules.includes(n.module),
  );

  const displayName =
    flags.customBranding && flags.brandName ? flags.brandName : company.name;

  return (
    <aside
      className="w-56 shrink-0 flex flex-col"
      style={{
        background: accentColor || "var(--sidebar-bg-1)",
        borderRight: "1px solid var(--secondary)",
      }}
    >
      {/* ── Brand header ── */}
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--sidebar-divider)" }}>
        <div className="flex items-center gap-2.5">
          <div className="size-10 shrink-0 cursor-pointer" onClick={cycleAccent} title="Click to cycle background accent">
            <img src={brandLogo} alt={`${displayName} logo`} className="w-full h-full object-contain" />
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
              color: "var(--warning)",
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
            n.to === "/dispatch" ? unassignedCount :
            n.to === "/drivers"  ? pendingTachoCount : 0;

          return (
            <Link
              key={n.to}
              to={n.to}
              className="nav-item"
              style={active ? {
                color: "var(--primary-bright)",
                background: "oklch(0.62 0.22 245 / 0.12)",
                borderLeft: "2px solid var(--primary)",
                paddingLeft: "calc(0.75rem - 2px)",
              } : {}}
            >
              <Icon
                className="size-4 shrink-0"
                style={{ color: active ? "var(--primary)" : undefined }}
              />
              <span className="flex-1 truncate">{n.label}</span>
              {badgeCount > 0 && (
                <span
                  className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full font-mono font-bold text-[10px] tabular-nums"
                  style={{
                    background: n.to === "/alerts"
                      ? "oklch(0.63 0.22 20 / 0.9)"
                      : n.to === "/drivers"
                        ? "oklch(0.80 0.18 72 / 0.95)"
                        : "oklch(0.62 0.22 245 / 0.9)",
                    color: n.to === "/drivers" ? "#1a1200" : "var(--primary-foreground)",
                    boxShadow: n.to === "/alerts"
                      ? "0 0 6px oklch(0.63 0.22 20 / 0.4)"
                      : n.to === "/drivers"
                        ? "0 0 6px oklch(0.80 0.18 72 / 0.5)"
                        : "0 0 6px oklch(0.62 0.22 245 / 0.4)",
                  }}
                >
                  {n.to === "/drivers" ? "! " : ""}{badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </Link>
          );
        })}

        {isSuperAdmin && (
          <>
            <div className="my-2 mx-1" style={{ height: 1, background: "var(--sidebar-divider)" }} />
            <Link
              to="/admin"
              className="nav-item"
              style={path.startsWith("/admin") ? {
                color: "var(--primary-bright)",
                background: "oklch(0.62 0.22 245 / 0.12)",
                borderLeft: "2px solid var(--primary)",
                paddingLeft: "calc(0.75rem - 2px)",
              } : {}}
            >
              <Shield className="size-4 shrink-0" style={{ color: "var(--primary)" }} />
              <span className="flex-1">Admin Panel</span>
            </Link>
          </>
        )}
      </nav>

      {/* ── Footer ── Modern compact design with integrated controls */}
      <div
        className="px-2.5 py-2.5 space-y-1.5"
        style={{ borderTop: "1px solid var(--sidebar-divider)" }}
      >
        {/* Control row: Auto-refresh · AI · theme toggle */}
        <div className="flex items-center justify-between gap-1.5 px-1.5 py-1.5 rounded-lg transition-colors hover:bg-surface/50">
          <div className="flex items-center gap-1">
            <AutoRefreshButton />
            {flags.modules.includes("ai_agent") && <AIChatWidget />}
          </div>
          <ThemeToggle compact />
        </div>

        {/* User row: Modern card with integrated controls */}
        <div
          className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 transition-all duration-200 hover:bg-surface-2/80 group"
          style={{ background: "var(--surface)" }}
        >
          {/* Avatar (click to upload a profile picture) */}
          <FooterAvatar userId={userId} avatarUrl={avatarUrl ?? null} fallback={(name ?? email).charAt(0).toUpperCase()} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium text-foreground truncate leading-tight">{name ?? email}</div>
            <div className="text-[8px] font-mono uppercase tracking-widest mt-0.5 text-muted-foreground"
              style={{ color: "var(--muted-foreground-2)" }}>
              {role}
            </div>
          </div>
          {/* Action buttons: compact and modern */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <ProfileSwitcher currentUserId={userId} />
            <button
              onClick={signOut}
              title="Sign out"
              className="size-5 shrink-0 grid place-items-center rounded-md transition-all duration-150 hover:scale-110 active:scale-95"
              style={{
                color: "var(--muted-foreground-2)",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = "var(--destructive)";
                e.currentTarget.style.background = "oklch(0.58 0.22 20 / 0.1)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = "var(--muted-foreground-2)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <LogOut className="size-3" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}


function FooterAvatar({ userId, avatarUrl, fallback }: { userId: string; avatarUrl: string | null; fallback: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const saveAvatar = useServerFn(setMemberAvatar);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      await saveAvatar({ data: { avatarUrl: url } });
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        title="Change photo"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="size-6 rounded-md grid place-items-center shrink-0 text-[10px] font-mono font-bold overflow-hidden disabled:opacity-50"
        style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "1px solid var(--border)" }}
      >
        {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : fallback}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </>
  );
}
