import { Link, useRouterState } from "@tanstack/react-router";
import {
  Map,
  Truck,
  Warehouse,
  ClipboardList,
  AlertTriangle,
  LogOut,
  Shield,
  Users,
  ScrollText,
  LifeBuoy,
  CreditCard,
  UserCog,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAlertCount, useUnassignedJobCount } from "@/lib/use-alerts";
import { useTenant, useFeatureFlags } from "@/lib/tenant-context";
import { signOut } from "@/lib/auth-context";
import type { TenantModule } from "@/lib/types";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoIcon } from "@/components/LogoIcon";
import { AutoRefreshButton } from "@/components/dispatch/toolbar";
import { SupportCaseModal } from "@/components/support/SupportCaseModal";
import { AIChatWidget } from "@/components/ai/ChatWidget";
import { useTheme } from "@/lib/theme-context";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { setMemberAvatar } from "@/lib/admin-users.functions";
import brandLogo from "@/assets/brand-logo.png";

void ClipboardList;

const ALL_NAV: ReadonlyArray<{
  to: string;
  label: string;
  icon: typeof Map;
  module: TenantModule | null;
  adminOnly?: boolean;
}> = [
  { to: "/", label: "Live Map", icon: Map, module: "maps" },
  { to: "/dispatch", label: "Dispatch", icon: Truck, module: "dispatch" },
  { to: "/drivers", label: "Drivers", icon: Users, module: "drivers" },
  { to: "/warehouses", label: "Warehouses", icon: Warehouse, module: "warehouses" },
  { to: "/alerts", label: "Alerts", icon: AlertTriangle, module: "alerts" },
  { to: "/events", label: "Events", icon: ScrollText, module: "events", adminOnly: true },
  { to: "/team", label: "Team", icon: UserCog, module: null, adminOnly: true },
  { to: "/billing", label: "Billing", icon: CreditCard, module: null, adminOnly: true },
];

export function Sidebar() {
  const [caseOpen, setCaseOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const alertCount = useAlertCount();
  const unassignedCount = useUnassignedJobCount();
  const { company, email, role, isSuperAdmin, name, userId, avatarUrl } = useTenant();
  const flags = useFeatureFlags();
  const { cycleAccent, accentColor } = useTheme();
  const [collapsed, setCollapsed] = useState(
    () =>
      typeof window !== "undefined" && window.localStorage.getItem("sidebar.collapsed") === "1",
  );
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined")
        window.localStorage.setItem("sidebar.collapsed", next ? "1" : "0");
      return next;
    });

  const isAdmin = role === "admin" || isSuperAdmin;
  const visibleNav = ALL_NAV.filter(
    (n) => (n.module === null || flags.modules.includes(n.module)) && (!n.adminOnly || isAdmin),
  );

  const displayName = flags.customBranding && flags.brandName ? flags.brandName : company.name;

  return (
    <aside
      className={
        (collapsed ? "w-16" : "w-56") + " shrink-0 flex flex-col transition-[width] duration-200"
      }
      style={{
        background: accentColor || "var(--sidebar-bg-1)",
        borderRight: "1px solid var(--secondary)",
      }}
    >
      <div
        className={(collapsed ? "px-2" : "px-4") + " py-3"}
        style={{ borderBottom: "1px solid var(--sidebar-divider)" }}
      >
        <div className={"flex items-center " + (collapsed ? "flex-col gap-2" : "gap-2.5")}>
          <div
            className={(collapsed ? "size-8" : "size-10") + " shrink-0 cursor-pointer"}
            onClick={cycleAccent}
            title="Click to cycle background accent"
          >
            <img
              src={brandLogo}
              alt={displayName + " logo"}
              className="w-full h-full object-contain"
            />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight truncate leading-tight">
                {displayName}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-0.5">
                UK · Dispatch
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            className={
              (collapsed ? "" : "ml-auto ") +
              "size-6 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            }
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </div>

        {!collapsed && company.subscription_status === "trial" && (
          <div
            className="mt-3 rounded-md px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-center"
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

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visibleNav.map((n) => {
          const Icon = n.icon;
          const active = path === n.to;
          const badgeCount =
            n.to === "/alerts" ? alertCount : n.to === "/dispatch" ? unassignedCount : 0;

          return (
            <Link
              key={n.to}
              to={n.to}
              title={collapsed ? n.label : undefined}
              className={"nav-item " + (collapsed ? "justify-center relative" : "")}
              style={
                active
                  ? {
                      color: "var(--primary-bright)",
                      background: "oklch(0.62 0.22 245 / 0.12)",
                      borderLeft: "2px solid var(--primary)",
                      paddingLeft: "calc(0.75rem - 2px)",
                    }
                  : {}
              }
            >
              <Icon
                className="size-4 shrink-0"
                style={{ color: active ? "var(--primary)" : undefined }}
              />
              {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
              {!collapsed && badgeCount > 0 && (
                <span
                  className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full font-mono font-bold text-[10px] tabular-nums"
                  style={{
                    background:
                      n.to === "/alerts"
                        ? "oklch(0.63 0.22 20 / 0.9)"
                        : "oklch(0.62 0.22 245 / 0.9)",
                    color: "var(--primary-foreground)",
                    boxShadow:
                      n.to === "/alerts"
                        ? "0 0 6px oklch(0.63 0.22 20 / 0.4)"
                        : "0 0 6px oklch(0.62 0.22 245 / 0.4)",
                  }}
                >
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
              {collapsed && badgeCount > 0 && (
                <span
                  className="absolute top-1 right-1.5 size-2 rounded-full"
                  style={{
                    background:
                      n.to === "/alerts"
                        ? "oklch(0.63 0.22 20 / 0.95)"
                        : "oklch(0.62 0.22 245 / 0.95)",
                  }}
                />
              )}
            </Link>
          );
        })}

        {isSuperAdmin && (
          <>
            <div
              className="my-2 mx-1"
              style={{ height: 1, background: "var(--sidebar-divider)" }}
            />
            <Link
              to="/admin"
              title={collapsed ? "Admin Panel" : undefined}
              className={"nav-item " + (collapsed ? "justify-center" : "")}
              style={
                path.startsWith("/admin")
                  ? {
                      color: "var(--primary-bright)",
                      background: "oklch(0.62 0.22 245 / 0.12)",
                      borderLeft: "2px solid var(--primary)",
                      paddingLeft: "calc(0.75rem - 2px)",
                    }
                  : {}
              }
            >
              <Shield className="size-4 shrink-0" style={{ color: "var(--primary)" }} />
              {!collapsed && <span className="flex-1">Admin Panel</span>}
            </Link>
          </>
        )}
      </nav>

      {collapsed ? (
        <div
          className="p-2 flex flex-col items-center gap-2"
          style={{ borderTop: "1px solid var(--sidebar-divider)" }}
        >
          <FooterAvatar
            userId={userId}
            avatarUrl={avatarUrl ?? null}
            fallback={(name ?? email).charAt(0).toUpperCase()}
          />
          <button
            onClick={signOut}
            title="Sign out"
            className="size-7 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="p-2" style={{ borderTop: "1px solid var(--sidebar-divider)" }}>
          <div
            className="rounded-2xl border border-border/60 overflow-hidden shadow-sm"
            style={{ background: accentColor || "var(--surface)" }}
          >
            <div
              className="flex items-center gap-1.5 px-2 py-2"
              style={{ background: accentColor ? "rgba(0,0,0,0.06)" : "var(--background)" }}
            >
              <AutoRefreshButton />
              {flags.modules.includes("ai_agent") && <AIChatWidget />}
              <button
                type="button"
                onClick={() => setCaseOpen(true)}
                data-ai-target="create-case"
                title="Create a support case"
                aria-label="Create a support case"
                className="grid size-7 shrink-0 place-items-center rounded-full text-white shadow-sm transition-transform hover:scale-110 hover:brightness-105 active:scale-95"
                style={{ background: "#f97316" }}
              >
                <LogoIcon
                  src="/support-logo.png"
                  alt="Create a support case"
                  className="size-5"
                  fallback={<LifeBuoy className="size-4" />}
                />
              </button>
              <div className="flex-1" />
              <ThemeToggle compact />
            </div>
            <div className="flex items-center gap-2.5 px-2.5 py-2 border-t border-border/50">
              <FooterAvatar
                userId={userId}
                avatarUrl={avatarUrl ?? null}
                fallback={(name ?? email).charAt(0).toUpperCase()}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-foreground truncate leading-tight">
                  {name ?? email}
                </div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/70 mt-0.5">
                  {role}
                </div>
              </div>
              <ProfileSwitcher currentUserId={userId} />
              <button
                onClick={signOut}
                title="Sign out"
                className="size-7 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
      {caseOpen && <SupportCaseModal onClose={() => setCaseOpen(false)} />}
    </aside>
  );
}

function FooterAvatar({
  userId,
  avatarUrl,
  fallback,
}: {
  userId: string;
  avatarUrl: string | null;
  fallback: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const saveAvatar = useServerFn(setMemberAvatar);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = userId + "/" + Date.now() + "." + ext;
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
        className="size-10 rounded-md overflow-hidden shrink-0 disabled:opacity-50 hover:opacity-80 transition-opacity"
        style={{ background: avatarUrl ? "transparent" : "var(--secondary)" }}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span
            className="grid place-items-center w-full h-full text-sm font-mono font-bold"
            style={{ color: "var(--muted-foreground)" }}
          >
            {fallback}
          </span>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </>
  );
}
