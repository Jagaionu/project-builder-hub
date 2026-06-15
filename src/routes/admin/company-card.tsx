import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  Company,
  SubscriptionStatus,
  CompanyPlan,
  TenantConfig,
  TenantModule,
} from "@/lib/types";
import { DEFAULT_TENANT_CONFIG } from "@/lib/types";
import {
  createCompanyAdmin,
  listCompanyMembers,
  createCompanyProfile,
  resetProfilePassword,
  deleteProfile,
  deleteCompany,
} from "@/lib/admin-users.functions";
import {
  CheckCircle,
  XCircle,
  Clock,
  Ban,
  ChevronDown,
  ChevronUp,
  Save,
  UserPlus,
  Copy,
  Trash2,
  AlertTriangle,
  Shield,
  User,
  Building2,
  Key,
} from "lucide-react";
import { toast } from "sonner";
import { useTeamSync } from "@/lib/use-team-sync";

function generatePassword(len = 16) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

// Per-plan caps (driver + own-warehouse counts, on top of the global warehouses).
// 0 = unlimited (enterprise).
const PLAN_LIMITS: Record<CompanyPlan, { drivers: number; warehouses: number }> = {
  starter: { drivers: 30, warehouses: 25 },
  pro: { drivers: 70, warehouses: 50 },
  enterprise: { drivers: 0, warehouses: 0 },
};

// Synthetic logins are `name@{slug}.team`; show admins the short `name@slug`.
function shortLogin(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at < 0) return email;
  return email.slice(0, at) + "@" + email.slice(at + 1).split(".")[0];
}

const STATUS_CONFIG: Record<
  SubscriptionStatus,
  { label: string; color: string; icon: React.ElementType }
> = {
  active: { label: "Active", color: "text-success", icon: CheckCircle },
  trial: { label: "Trial", color: "text-warning", icon: Clock },
  suspended: { label: "Suspended", color: "text-destructive", icon: Ban },
  cancelled: { label: "Cancelled", color: "text-muted-foreground", icon: XCircle },
};

const ALL_MODULES: ReadonlyArray<TenantModule> = [
  "dispatch",
  "jobs",
  "drivers",
  "warehouses",
  "alerts",
  "events",
  "maps",
  "ai_agent",
];

const MODULE_LABELS: Record<TenantModule, string> = {
  dispatch: "Dispatch",
  jobs: "Jobs",
  drivers: "Drivers",
  warehouses: "Warehouses",
  alerts: "Alerts",
  events: "Events",
  maps: "Maps",
  ai_agent: "AI Agent",
};

type Member = {
  id: string;
  user_id: string;
  role: string;
  name: string | null;
  must_set_password: boolean;
  email: string | null;
  password: string | null;
};

interface CompanyCardProps {
  company: Company;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (id: string, s: SubscriptionStatus) => void;
  onConfigSave: (id: string, c: TenantConfig) => void;
}

export function CompanyCard({
  company,
  expanded,
  onToggle,
  onStatusChange,
  onConfigSave,
}: CompanyCardProps) {
  const status = STATUS_CONFIG[company.subscription_status];
  const StatusIcon = status.icon;
  const [config, setConfig] = useState<TenantConfig>({
    ...DEFAULT_TENANT_CONFIG,
    ...company.config,
  });
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const notifyTeam = useTeamSync(company.id, expanded, () => setRefreshKey((k) => k + 1));
  const [members, setMembers] = useState<Member[]>([]);
  const createAdmin = useServerFn(createCompanyAdmin);
  const fetchMembers = useServerFn(listCompanyMembers);
  const addProfile = useServerFn(createCompanyProfile);
  const resetPwd = useServerFn(resetProfilePassword);
  const delProfile = useServerFn(deleteProfile);
  const delCompanyFn = useServerFn(deleteCompany);
  const [profileName, setProfileName] = useState("");
  const [issued, setIssued] = useState<{
    name: string;
    email: string;
    tempPassword: string;
  } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const derivedEmail = `${company.slug}@admin.local`;
  const adminUsers = members.filter((m) => m.role === "admin");
  const regularMembers = members.filter((m) => m.role !== "admin");

  useEffect(() => {
    if (!expanded) return;
    fetchMembers({ data: { companyId: company.id } })
      .then((r) => setMembers(r as Member[]))
      .catch(() => toast.error("Failed to load members"));
  }, [expanded, company.id, fetchMembers, refreshKey]);

  function toggleModule(mod: TenantModule) {
    setConfig((prev) => ({
      ...prev,
      modules: prev.modules.includes(mod)
        ? prev.modules.filter((m) => m !== mod)
        : [...prev.modules, mod],
    }));
  }

  async function handleGenerateCredentials() {
    setCreating(true);
    const password = generatePassword();
    try {
      await createAdmin({ data: { companyId: company.id, email: derivedEmail, password } });
      toast.success(
        `Password ${members.length > 0 ? "regenerated" : "generated"} for ${company.name}`,
      );
      setRefreshKey((k) => k + 1);
      notifyTeam();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteCompany() {
    setDeleting(true);
    try {
      await delCompanyFn({ data: { companyId: company.id } });
      toast.success(`Company "${company.name}" permanently deleted`);
      onToggle();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete company");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmName("");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{company.name}</span>
            <span className="text-[11px] font-mono text-muted-foreground hidden sm:inline">
              /{company.slug}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
            {company.plan.toUpperCase()} &middot; {company.config?.modules?.length ?? 0} mod.
          </div>
        </div>
        <div className={`flex items-center gap-1 text-[11px] font-medium ${status.color}`}>
          <StatusIcon className="size-3" />
          {status.label}
        </div>
        {expanded ? (
          <ChevronUp className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-5">
          {/* Subscription Status */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Subscription Status
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["active", "trial", "suspended", "cancelled"] as SubscriptionStatus[]).map((s) => {
                const cfg = STATUS_CONFIG[s];
                const Icon = cfg.icon;
                return (
                  <button
                    key={s}
                    onClick={() => onStatusChange(company.id, s)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                      company.subscription_status === s
                        ? "bg-surface-2 border-border text-foreground"
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    <Icon className={`size-3 ${cfg.color}`} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            {company.subscription_status === "suspended" && (
              <p className="mt-1.5 text-[11px] text-destructive font-mono">
                This company is locked out of the app right now.
              </p>
            )}
          </div>

          {/* Plan */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Plan
            </div>
            <div className="flex gap-1.5">
              {(["starter", "pro", "enterprise"] as CompanyPlan[]).map((p) => {
                const lim = PLAN_LIMITS[p];
                return (
                  <button
                    key={p}
                    onClick={async () => {
                      const newConfig = {
                        ...config,
                        maxDrivers: lim.drivers,
                        maxWarehouses: lim.warehouses,
                      };
                      setConfig(newConfig);
                      await supabase
                        .from("companies" as never)
                        .update({ plan: p, config: newConfig } as never)
                        .eq("id", company.id);
                      toast.success(`Plan set to ${p}`);
                    }}
                    className={`flex flex-col items-start px-2.5 py-1 rounded text-[11px] font-medium border transition-colors capitalize ${
                      company.plan === p
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    <span>{p}</span>
                    <span
                      className={`text-[9px] font-normal lowercase ${company.plan === p ? "text-primary-foreground/80" : "text-muted-foreground/70"}`}
                    >
                      {lim.drivers ? `${lim.drivers} drv / ${lim.warehouses} wh` : "unlimited"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trial expiry */}
          {company.subscription_status === "trial" && (
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Trial expires
              </label>
              <div className="mt-2 flex gap-2 items-end">
                <input
                  type="date"
                  value={
                    company.subscription_ends_at
                      ? new Date(company.subscription_ends_at).toISOString().split("T")[0]
                      : ""
                  }
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    const newDate = new Date(e.target.value);
                    const { error } = await supabase
                      .from("companies" as never)
                      .update({ subscription_ends_at: newDate.toISOString() } as never)
                      .eq("id", company.id);
                    if (error) {
                      toast.error("Failed to update trial date");
                      return;
                    }
                    toast.success("Trial date updated");
                  }}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const newDate = new Date(company.subscription_ends_at || new Date());
                    newDate.setDate(newDate.getDate() + 7);
                    const { error } = await supabase
                      .from("companies" as never)
                      .update({ subscription_ends_at: newDate.toISOString() } as never)
                      .eq("id", company.id);
                    if (error) {
                      toast.error("Failed to extend trial");
                      return;
                    }
                    toast.success("Trial extended by 7 days");
                  }}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
                >
                  Extend 7d
                </button>
              </div>
            </div>
          )}

          {/* Modules */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Enabled Modules
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_MODULES.map((mod) => (
                <button
                  key={mod}
                  onClick={() => toggleModule(mod)}
                  className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                    config.modules.includes(mod)
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border/50 text-muted-foreground/50 hover:text-muted-foreground"
                  }`}
                >
                  {MODULE_LABELS[mod]}
                </button>
              ))}
            </div>
          </div>

          {/* Limits */}
          <div>
            <div className="flex gap-6">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Max Drivers
                </label>
                <input
                  type="number"
                  value={config.maxDrivers}
                  onChange={(e) => setConfig((p) => ({ ...p, maxDrivers: Number(e.target.value) }))}
                  className="mt-1 w-28 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Max Warehouses
                </label>
                <input
                  type="number"
                  value={config.maxWarehouses}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, maxWarehouses: Number(e.target.value) }))
                  }
                  className="mt-1 w-28 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Set by the plan — override here if needed. 0 = unlimited. Excludes global warehouses.
            </p>
          </div>

          {/* Branding */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Custom Branding
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={config.customBranding}
                onChange={(e) => setConfig((p) => ({ ...p, customBranding: e.target.checked }))}
                className="rounded border-border"
              />
              Enable custom branding
            </label>
            {config.customBranding && (
              <div className="max-w-xs">
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Brand Name
                </label>
                <input
                  type="text"
                  value={config.brandName ?? ""}
                  onChange={(e) => setConfig((p) => ({ ...p, brandName: e.target.value || null }))}
                  placeholder="Acme Logistics"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Logo is uploaded as a PNG.</p>
              </div>
            )}
          </div>

          {/* Save */}
          <button
            onClick={() => onConfigSave(company.id, config)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Save className="size-4" /> Save Configuration
          </button>

          {/* Users & Profiles */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
              Users &amp; Profiles
            </div>

            {/* Company Admin */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 overflow-hidden mb-3">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
                <Building2 className="size-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary">{company.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  &mdash; Company Admin
                </span>
                {adminUsers.length > 0 && (
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                    {adminUsers[0].email}
                  </span>
                )}
              </div>

              <div className="px-3 py-2.5">
                {adminUsers.length > 0 ? (
                  adminUsers.map((m) => (
                    <div key={m.id}>
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="size-3 text-primary shrink-0" />
                        <span className="text-xs font-medium">{m.name ?? "Admin"}</span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-primary/15 text-primary border border-primary/20">
                          ADMIN
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {m.password ? (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(m.password!);
                                toast.success("Password copied");
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-background border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                            >
                              <Copy className="size-3" /> Copy password
                            </button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/50 font-mono">
                              No stored password
                            </span>
                          )}
                          <button
                            disabled={profileBusy}
                            onClick={async () => {
                              setProfileBusy(true);
                              try {
                                const r = (await resetPwd({ data: { memberId: m.id } })) as {
                                  tempPassword: string;
                                };
                                setIssued({
                                  name: m.name ?? m.email ?? "",
                                  email: m.email ?? "",
                                  tempPassword: r.tempPassword,
                                });
                                toast.success("Password reset — copy the new credentials below");
                                setRefreshKey((k) => k + 1);
                                notifyTeam();
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Reset failed");
                              } finally {
                                setProfileBusy(false);
                              }
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-background border border-border text-muted-foreground hover:text-foreground hover:border-warning/30 transition-colors disabled:opacity-50"
                          >
                            <Key className="size-3" /> Reset password
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={handleGenerateCredentials}
                          disabled={creating}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-background border border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50 shrink-0"
                        >
                          <Key className="size-3" />
                          {creating ? "Working..." : "Regenerate"}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-2">
                    <p className="text-[11px] text-muted-foreground mb-2">
                      No admin user yet. Generate credentials to create the admin login.
                    </p>
                    <button
                      type="button"
                      onClick={handleGenerateCredentials}
                      disabled={creating}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      <Key className="size-3.5" />
                      {creating ? "Working..." : "Generate admin credentials"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Members */}
            <div className="rounded-lg border border-border bg-surface-2/30 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2">
                <User className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">
                  Members{regularMembers.length > 0 ? ` (${regularMembers.length})` : ""}
                </span>
              </div>

              {regularMembers.length > 0 ? (
                <div className="px-3 pb-2 space-y-1.5">
                  {regularMembers.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2 border border-border/50"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="size-6 rounded-full bg-surface-2 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-semibold text-muted-foreground">
                              {(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="text-xs font-medium truncate">
                            {m.name ?? m.email ?? m.user_id.slice(0, 8)}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate mt-0.5 ml-8">
                          {shortLogin(m.email)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-2 text-muted-foreground border border-border">
                          MEMBER
                        </span>
                        {m.must_set_password && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-warning/10 text-warning border border-warning/20">
                            PENDING
                          </span>
                        )}
                        {m.password && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(m.password!);
                              toast.success("Password copied");
                            }}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Copy className="size-3" />
                          </button>
                        )}
                        <button
                          disabled={profileBusy}
                          onClick={async () => {
                            setProfileBusy(true);
                            try {
                              const r = (await resetPwd({ data: { memberId: m.id } })) as {
                                tempPassword: string;
                              };
                              setIssued({
                                name: m.name ?? m.email ?? "",
                                email: m.email ?? "",
                                tempPassword: r.tempPassword,
                              });
                              toast.success("Password reset");
                              setRefreshKey((k) => k + 1);
                              notifyTeam();
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Reset failed");
                            } finally {
                              setProfileBusy(false);
                            }
                          }}
                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        >
                          Reset
                        </button>
                        <button
                          disabled={profileBusy}
                          onClick={async () => {
                            if (
                              !confirm(
                                `Remove member "${m.name ?? m.email}"? This deletes their login.`,
                              )
                            )
                              return;
                            setProfileBusy(true);
                            try {
                              await delProfile({ data: { memberId: m.id } });
                              toast.success("Member removed");
                              setRefreshKey((k) => k + 1);
                              notifyTeam();
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Remove failed");
                            } finally {
                              setProfileBusy(false);
                            }
                          }}
                          className="p-1 rounded text-destructive/70 hover:text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-3 text-center">
                  <p className="text-[11px] text-muted-foreground">No members yet.</p>
                </div>
              )}
            </div>

            {/* Issued credentials */}
            {issued && (
              <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                <div className="text-[10px] font-mono uppercase tracking-widest text-primary mb-1">
                  One-time credentials — copy now
                </div>
                <div className="font-mono break-all">{issued.email}</div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="font-mono break-all">{issued.tempPassword}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(issued.tempPassword);
                      toast.success("Password copied");
                    }}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <Copy className="size-3" /> Copy
                  </button>
                </div>
              </div>
            )}

            {/* Add Member */}
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Associate name (e.g. Jane Smith)"
                className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                disabled={profileBusy || !profileName.trim()}
                onClick={async () => {
                  setProfileBusy(true);
                  try {
                    const r = (await addProfile({
                      data: { companyId: company.id, name: profileName.trim() },
                    })) as { name: string; email: string; tempPassword: string };
                    setIssued(r);
                    setProfileName("");
                    toast.success(`Profile "${r.name}" created`);
                    setRefreshKey((k) => k + 1);
                    notifyTeam();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Create failed");
                  } finally {
                    setProfileBusy(false);
                  }
                }}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <UserPlus className="size-4" /> Add member
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="border-t border-border pt-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-destructive mb-3">
              Danger Zone
            </div>
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-destructive">Delete this company</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Permanently removes <strong>{company.name}</strong> and all associated data —
                    members, drivers, warehouses, jobs, events, and activity logs. This cannot be
                    undone.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirmName("");
                    setShowDeleteConfirm(true);
                  }}
                  className="shrink-0 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                  <Trash2 className="size-3.5 inline mr-1" />
                  Delete
                </button>
              </div>
            </div>
          </div>

          {/* Company ID */}
          <div className="border-t border-border pt-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Company ID
            </div>
            <code className="text-[11px] font-mono text-muted-foreground select-all break-all">
              {company.id}
            </code>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !deleting && setShowDeleteConfirm(false)}
          />
          <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-destructive/30 bg-surface shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="size-5 text-destructive" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Delete {company.name}?</h3>
                  <p className="text-[11px] text-muted-foreground">This action is irreversible</p>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                All company data will be permanently deleted, including members, drivers,
                warehouses, jobs, events, and activity logs.
              </p>

              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Type <span className="text-destructive font-bold">{company.name}</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={company.name}
                  disabled={deleting}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-destructive disabled:opacity-50"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setShowDeleteConfirm(false);
                  }}
                  autoFocus
                />
              </div>
            </div>

            <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-surface-2/30">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmName("");
                }}
                disabled={deleting}
                className="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteCompany}
                disabled={deleting || deleteConfirmName !== company.name}
                className="rounded-md bg-destructive px-4 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Company"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CompanyCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="skeleton h-4 w-32 rounded mb-1" />
          <div className="skeleton h-3 w-24 rounded" />
        </div>
        <div className="skeleton h-5 w-14 rounded" />
        <div className="skeleton size-3.5 rounded" />
      </div>
    </div>
  );
}
