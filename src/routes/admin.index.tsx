import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Company, SubscriptionStatus, CompanyPlan, TenantConfig, TenantModule, Warehouse } from "@/lib/types";
import { DEFAULT_TENANT_CONFIG } from "@/lib/types";
import { createCompanyAdmin, listCompanyMembers, createCompanyProfile, resetProfilePassword, deleteProfile } from "@/lib/admin-users.functions";
import {
  CheckCircle, XCircle, Clock, Ban,
  Plus, ChevronDown, ChevronUp, Save, UserPlus, Copy, Trash2, Pencil,
} from "lucide-react";
import { toast } from "sonner";

function generatePassword(len = 16) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

const STATUS_CONFIG: Record<SubscriptionStatus, { label: string; color: string; icon: React.ElementType }> = {
  active:    { label: "Active",     color: "text-success",     icon: CheckCircle },
  trial:     { label: "Trial",      color: "text-warning",     icon: Clock },
  suspended: { label: "Suspended",  color: "text-destructive", icon: Ban },
  cancelled: { label: "Cancelled",  color: "text-muted-foreground", icon: XCircle },
};

const ALL_MODULES: ReadonlyArray<TenantModule> = ["dispatch", "jobs", "drivers", "warehouses", "alerts", "events", "maps", "ai_agent"];

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

function AdminDashboard() {
  const [tab, setTab] = useState<"companies" | "warehouses">("companies");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWarehouse, setNewWarehouse] = useState({ code: "", name: "", latitude: 0, longitude: 0, address: "" });
  const [showAddWarehouse, setShowAddWarehouse] = useState(false);
  const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);
  const [editingWarehouse, setEditingWarehouse] = useState({ code: "", name: "", latitude: 0, longitude: 0, address: "" });

  async function loadCompanies() {
    const { data, error } = await supabase
      .from("companies" as never)
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setCompanies(data as unknown as Company[]);
  }

  async function loadWarehouses() {
    const { data, error } = await supabase
      .from("warehouses" as never)
      .select("*, companies(name)")
      .order("code", { ascending: true });
    if (!error && data) setWarehouses(data as unknown as Warehouse[]);
  }

  useEffect(() => {
    Promise.all([loadCompanies(), loadWarehouses()]).then(() => setLoading(false));
  }, []);

  async function updateStatus(id: string, status: SubscriptionStatus) {
    const { error } = await supabase
      .from("companies" as never)
      .update({ subscription_status: status } as never)
      .eq("id", id);
    if (error) { toast.error("Failed to update status"); return; }
    toast.success(`Status updated to ${status}`);
    loadCompanies();
  }

  async function updateConfig(id: string, config: TenantConfig) {
    const { error } = await supabase
      .from("companies" as never)
      .update({ config } as never)
      .eq("id", id);
    if (error) { toast.error("Failed to save config"); return; }
    toast.success("Config saved");
    loadCompanies();
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground font-mono">Loading…</div>;
  }

  // Calculate trial companies expiring soon (within 7 days)
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const expiringTrials = companies
    .filter(
      (c) =>
        c.subscription_status === "trial" &&
        c.subscription_ends_at &&
        new Date(c.subscription_ends_at) <= in7Days &&
        new Date(c.subscription_ends_at) > now,
    )
    .sort((a, b) => new Date(a.subscription_ends_at!).getTime() - new Date(b.subscription_ends_at!).getTime());

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="mb-4">
        <h1 className="text-lg font-semibold">Admin Dashboard</h1>
        <p className="text-xs text-muted-foreground">System management</p>
      </div>

      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setTab("companies")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "companies"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Companies
        </button>
        <button
          onClick={() => setTab("warehouses")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "warehouses"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Global Warehouses
        </button>
      </div>

      {tab === "companies" && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{companies.length} total</p>
            </div>
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-4" /> New Company
            </button>
          </div>

          {expiringTrials.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-warning mb-3">Trials Expiring Soon</div>
              <div className="space-y-2">
                {expiringTrials.map((c) => {
                  const daysLeft = Math.ceil(
                    (new Date(c.subscription_ends_at!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
                  );
                  const color = daysLeft <= 3 ? "text-destructive" : daysLeft <= 7 ? "text-warning" : "text-foreground";
                  const bgColor = daysLeft <= 3 ? "bg-destructive/10" : daysLeft <= 7 ? "bg-warning/10" : "bg-surface-2/40";
                  return (
                    <div key={c.id} className={`flex items-center justify-between gap-2 rounded px-3 py-2 ${bgColor}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className={`text-xs ${color}`}>
                          {daysLeft} day{daysLeft !== 1 ? "s" : ""} remaining
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const newDate = new Date(c.subscription_ends_at!);
                          newDate.setDate(newDate.getDate() + 7);
                          const { error } = await supabase
                            .from("companies" as never)
                            .update({ subscription_ends_at: newDate.toISOString() } as never)
                            .eq("id", c.id);
                          if (error) {
                            toast.error("Failed to extend trial");
                            return;
                          }
                          toast.success(`${c.name} trial extended by 7 days`);
                          loadCompanies();
                        }}
                        className="px-2 py-1 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
                      >
                        Extend 7d
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showCreateForm && (
            <CreateCompanyForm
              onCreated={() => { setShowCreateForm(false); loadCompanies(); }}
              onCancel={() => setShowCreateForm(false)}
            />
          )}

          {companies.map((company) => (
            <CompanyRow
              key={company.id}
              company={company}
              expanded={expandedId === company.id}
              onToggle={() => setExpandedId(expandedId === company.id ? null : company.id)}
              onStatusChange={updateStatus}
              onConfigSave={updateConfig}
            />
          ))}
        </>
      )}

      {tab === "warehouses" && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{warehouses.length} total</p>
            </div>
            <button
              onClick={() => setShowAddWarehouse(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-4" /> Add Warehouse
            </button>
          </div>

          {showAddWarehouse && (
            <div className="rounded-lg border border-primary/30 bg-surface p-4 space-y-3">
              <div className="text-xs font-semibold text-primary mb-1">New Warehouse</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Code</label>
                  <input
                    type="text"
                    value={newWarehouse.code}
                    onChange={(e) => setNewWarehouse({ ...newWarehouse, code: e.target.value })}
                    placeholder="BHX2"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Name</label>
                  <input
                    type="text"
                    value={newWarehouse.name}
                    onChange={(e) => setNewWarehouse({ ...newWarehouse, name: e.target.value })}
                    placeholder="Birmingham Hub"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={newWarehouse.latitude}
                    onChange={(e) => setNewWarehouse({ ...newWarehouse, latitude: parseFloat(e.target.value) })}
                    placeholder="52.5"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={newWarehouse.longitude}
                    onChange={(e) => setNewWarehouse({ ...newWarehouse, longitude: parseFloat(e.target.value) })}
                    placeholder="-1.9"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Address (optional)</label>
                <input
                  type="text"
                  value={newWarehouse.address}
                  onChange={(e) => setNewWarehouse({ ...newWarehouse, address: e.target.value })}
                  placeholder="123 Logistics Way, Birmingham"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    if (!newWarehouse.code || !newWarehouse.name) {
                      toast.error("Code and name are required");
                      return;
                    }
                    const { error } = await supabase.from("warehouses" as never).insert({
                      code: newWarehouse.code.trim(),
                      name: newWarehouse.name.trim(),
                      latitude: newWarehouse.latitude,
                      longitude: newWarehouse.longitude,
                      address: newWarehouse.address.trim() || null,
                    } as never);
                    if (error) { toast.error(error.message); return; }
                    toast.success(`Warehouse "${newWarehouse.name}" created`);
                    setNewWarehouse({ code: "", name: "", latitude: 0, longitude: 0, address: "" });
                    setShowAddWarehouse(false);
                    loadWarehouses();
                  }}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Create Warehouse
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddWarehouse(false)}
                  className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {warehouses.map((wh) => (
              <div key={wh.id} className={`rounded-lg border ${editingWarehouseId === wh.id ? 'border-primary/40 bg-surface' : 'border-border bg-surface'} p-4`}>
                {editingWarehouseId === wh.id ? (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-primary mb-2">Edit Warehouse</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Code</label>
                        <input
                          type="text"
                          value={editingWarehouse.code}
                          onChange={(e) => setEditingWarehouse({ ...editingWarehouse, code: e.target.value })}
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Name</label>
                        <input
                          type="text"
                          value={editingWarehouse.name}
                          onChange={(e) => setEditingWarehouse({ ...editingWarehouse, name: e.target.value })}
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Latitude</label>
                        <input
                          type="number"
                          step="0.0001"
                          value={editingWarehouse.latitude}
                          onChange={(e) => setEditingWarehouse({ ...editingWarehouse, latitude: parseFloat(e.target.value) })}
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Longitude</label>
                        <input
                          type="number"
                          step="0.0001"
                          value={editingWarehouse.longitude}
                          onChange={(e) => setEditingWarehouse({ ...editingWarehouse, longitude: parseFloat(e.target.value) })}
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Address (optional)</label>
                      <input
                        type="text"
                        value={editingWarehouse.address}
                        onChange={(e) => setEditingWarehouse({ ...editingWarehouse, address: e.target.value })}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!editingWarehouse.code || !editingWarehouse.name) {
                            toast.error("Code and name are required");
                            return;
                          }
                          const { error } = await supabase
                            .from("warehouses" as never)
                            .update({
                              code: editingWarehouse.code.trim(),
                              name: editingWarehouse.name.trim(),
                              latitude: editingWarehouse.latitude,
                              longitude: editingWarehouse.longitude,
                              address: editingWarehouse.address.trim() || null,
                            } as never)
                            .eq("id", wh.id);
                          if (error) { toast.error(error.message); return; }
                          toast.success(`Warehouse "${editingWarehouse.code}" updated`);
                          setEditingWarehouseId(null);
                          loadWarehouses();
                        }}
                        className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingWarehouseId(null)}
                        className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{wh.code}</span>
                        <span className="text-xs font-mono text-muted-foreground">{wh.name}</span>
                        {!(wh as Warehouse & { tenant_id?: string | null }).tenant_id ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/20">
                            GLOBAL
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-2 text-muted-foreground border border-border">
                            COMPANY
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1 font-mono">
                        {wh.latitude.toFixed(4)}, {wh.longitude.toFixed(4)}
                        {wh.address && <span className="ml-2">{wh.address}</span>}
                        {(wh as Warehouse & { companies?: { name: string } | null }).companies?.name && (
                          <span className="ml-2 text-muted-foreground/60">
                            — {(wh as Warehouse & { companies?: { name: string } | null }).companies!.name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingWarehouseId(wh.id);
                          setEditingWarehouse({ code: wh.code, name: wh.name, latitude: wh.latitude, longitude: wh.longitude, address: wh.address || "" });
                        }}
                        className="p-2 rounded-md text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm(`Delete warehouse "${wh.code}"? This cannot be undone.`)) {
                            const { error } = await supabase
                              .from("warehouses" as never)
                              .delete()
                              .eq("id", wh.id);
                            if (error) { toast.error("Failed to delete warehouse"); return; }
                            toast.success(`Warehouse "${wh.code}" deleted`);
                            loadWarehouses();
                          }
                        }}
                        className="p-2 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CompanyRow({
  company,
  expanded,
  onToggle,
  onStatusChange,
  onConfigSave,
}: {
  company: Company;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (id: string, s: SubscriptionStatus) => void;
  onConfigSave: (id: string, c: TenantConfig) => void;
}) {
  const status = STATUS_CONFIG[company.subscription_status];
  const StatusIcon = status.icon;
  const [config, setConfig] = useState<TenantConfig>({ ...DEFAULT_TENANT_CONFIG, ...company.config });
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [members, setMembers] = useState<Array<{ id: string; user_id: string; role: string; name: string | null; must_set_password: boolean; email: string | null; password: string | null }>>([]);
  const createAdmin = useServerFn(createCompanyAdmin);
  const fetchMembers = useServerFn(listCompanyMembers);
  const addProfile = useServerFn(createCompanyProfile);
  const resetPwd = useServerFn(resetProfilePassword);
  const delProfile = useServerFn(deleteProfile);
  const [profileName, setProfileName] = useState("");
  const [issued, setIssued] = useState<{ name: string; email: string; tempPassword: string } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const derivedEmail = `${company.slug}@admin.local`;

  useEffect(() => {
    if (!expanded) return;
    fetchMembers({ data: { companyId: company.id } })
      .then((r) => setMembers(r as typeof members))
      .catch(() => {});
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
      toast.success(`Password ${members.length > 0 ? "regenerated" : "generated"} for ${company.name}`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }



  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-surface-2/50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{company.name}</span>
            <span className="text-xs font-mono text-muted-foreground">/{company.slug}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
            {company.plan.toUpperCase()} · {company.config?.modules?.length ?? 0} modules
          </div>
        </div>
        <div className={`flex items-center gap-1.5 text-xs font-medium ${status.color}`}>
          <StatusIcon className="size-3.5" />
          {status.label}
        </div>
        {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-5">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Subscription Status</div>
            <div className="flex flex-wrap gap-2">
              {(["active", "trial", "suspended", "cancelled"] as SubscriptionStatus[]).map((s) => {
                const cfg = STATUS_CONFIG[s];
                const Icon = cfg.icon;
                return (
                  <button
                    key={s}
                    onClick={() => onStatusChange(company.id, s)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      company.subscription_status === s
                        ? "bg-surface-2 border-border text-foreground"
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    <Icon className={`size-3.5 ${cfg.color}`} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            {company.subscription_status === "suspended" && (
              <p className="mt-1.5 text-[11px] text-destructive font-mono">
                ⚠ This company is locked out of the app right now.
              </p>
            )}
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Plan</div>
            <div className="flex gap-2">
              {(["starter", "pro", "enterprise"] as CompanyPlan[]).map((p) => (
                <button
                  key={p}
                  onClick={async () => {
                    await supabase.from("companies" as never).update({ plan: p } as never).eq("id", company.id);
                    toast.success("Plan updated");
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors capitalize ${
                    company.plan === p
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {company.subscription_status === "trial" && (
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Trial expires — extend to give the company more time.</label>
              <div className="mt-2 flex gap-2 items-end">
                <input
                  type="date"
                  value={company.subscription_ends_at ? new Date(company.subscription_ends_at).toISOString().split("T")[0] : ""}
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    const newDate = new Date(e.target.value);
                    const { error } = await supabase.from("companies" as never).update({ subscription_ends_at: newDate.toISOString() } as never).eq("id", company.id);
                    if (error) { toast.error("Failed to update trial date"); return; }
                    toast.success("Trial date updated");
                  }}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const newDate = new Date(company.subscription_ends_at || new Date());
                    newDate.setDate(newDate.getDate() + 7);
                    const { error } = await supabase.from("companies" as never).update({ subscription_ends_at: newDate.toISOString() } as never).eq("id", company.id);
                    if (error) { toast.error("Failed to extend trial"); return; }
                    toast.success("Trial extended by 7 days");
                  }}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
                >
                  Extend 7 days
                </button>
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Enabled Modules</div>
            <div className="flex flex-wrap gap-2">
              {ALL_MODULES.map((mod) => (
                <button
                  key={mod}
                  onClick={() => toggleModule(mod)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Max Drivers</label>
              <input
                type="number"
                value={config.maxDrivers}
                onChange={(e) => setConfig((p) => ({ ...p, maxDrivers: Number(e.target.value) }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Max Warehouses</label>
              <input
                type="number"
                value={config.maxWarehouses}
                onChange={(e) => setConfig((p) => ({ ...p, maxWarehouses: Number(e.target.value) }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Custom Branding</div>
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Brand Name</label>
                  <input
                    type="text"
                    value={config.brandName ?? ""}
                    onChange={(e) => setConfig((p) => ({ ...p, brandName: e.target.value || null }))}
                    placeholder="Acme Logistics"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Brand Color (hex)</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="color"
                      value={config.brandColor ?? "#000000"}
                      onChange={(e) => setConfig((p) => ({ ...p, brandColor: e.target.value }))}
                      className="h-9 w-12 rounded border border-border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={config.brandColor ?? ""}
                      onChange={(e) => setConfig((p) => ({ ...p, brandColor: e.target.value || null }))}
                      placeholder="#1a56db"
                      className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Feature Toggles</div>
            <div className="space-y-2">
              {[
                { key: "showComplianceModule" as const, label: "Driver compliance tracking" },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config[key]}
                    onChange={(e) => setConfig((p) => ({ ...p, [key]: e.target.checked }))}
                    className="rounded border-border"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={() => onConfigSave(company.id, config)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Save className="size-4" /> Save Configuration
          </button>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Users &amp; Profiles</div>
            {members.length > 0 ? (
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{m.name ?? m.email ?? m.user_id.slice(0, 8)}</div>
                      <div className="font-mono text-[11px] text-muted-foreground truncate">{m.email}</div>
                      <div className="text-[11px] text-muted-foreground capitalize">
                        {m.role}{m.must_set_password ? " · must set password" : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {m.password && (
                        <button
                          onClick={() => { navigator.clipboard.writeText(m.password!); toast.success("Password copied"); }}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <Copy className="size-3" /> Copy
                        </button>
                      )}
                      <button
                        disabled={profileBusy}
                        onClick={async () => {
                          setProfileBusy(true);
                          try {
                            const r = await resetPwd({ data: { memberId: m.id } }) as { tempPassword: string };
                            setIssued({ name: m.name ?? m.email ?? "", email: m.email ?? "", tempPassword: r.tempPassword });
                            toast.success("Password reset");
                            setRefreshKey((k) => k + 1);
                          } catch (err) { toast.error(err instanceof Error ? err.message : "Reset failed"); }
                          finally { setProfileBusy(false); }
                        }}
                        className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        Reset
                      </button>
                      <button
                        disabled={profileBusy}
                        onClick={async () => {
                          if (!confirm(`Delete profile "${m.name ?? m.email}"? This removes their login.`)) return;
                          setProfileBusy(true);
                          try {
                            await delProfile({ data: { memberId: m.id } });
                            toast.success("Profile deleted");
                            setRefreshKey((k) => k + 1);
                          } catch (err) { toast.error(err instanceof Error ? err.message : "Delete failed"); }
                          finally { setProfileBusy(false); }
                        }}
                        className="text-destructive/80 hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                No users yet. Generate the admin login or add a profile by name.
              </p>
            )}

            {issued && (
              <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                <div className="text-[10px] font-mono uppercase tracking-widest text-primary mb-1">One-time credentials — copy now</div>
                <div className="font-mono break-all">{issued.email}</div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="font-mono break-all">{issued.tempPassword}</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(issued.tempPassword); toast.success("Password copied"); }}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <Copy className="size-3" /> Copy
                  </button>
                </div>
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Associate name (e.g. Jane Smith)"
                className="flex-1 min-w-[180px] rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                disabled={profileBusy || !profileName.trim()}
                onClick={async () => {
                  setProfileBusy(true);
                  try {
                    const r = await addProfile({ data: { companyId: company.id, name: profileName.trim() } }) as { name: string; email: string; tempPassword: string };
                    setIssued(r);
                    setProfileName("");
                    toast.success(`Profile "${r.name}" created`);
                    setRefreshKey((k) => k + 1);
                  } catch (err) { toast.error(err instanceof Error ? err.message : "Create failed"); }
                  finally { setProfileBusy(false); }
                }}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <UserPlus className="size-4" /> Add profile
              </button>
            </div>

            <button
              type="button"
              onClick={handleGenerateCredentials}
              disabled={creating}
              className="mt-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <UserPlus className="size-4" />
              {creating ? "Working…" : members.length > 0 ? "Regenerate admin password" : "Generate admin credentials"}
            </button>
          </div>



          <div className="border-t border-border pt-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Company ID</div>
            <code className="text-[11px] font-mono text-muted-foreground select-all break-all">{company.id}</code>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateCompanyForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [plan, setPlan] = useState<CompanyPlan>("starter");
  const [loading, setLoading] = useState(false);

  function toSlug(v: string) {
    return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);
    const { error } = await supabase.from("companies" as never).insert({
      name: name.trim(),
      slug: slug.trim() || toSlug(name),
      plan,
      subscription_status: "trial",
      subscription_ends_at: trialEndsAt.toISOString(),
    } as never);
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success(`Company "${name}" created (trial expires in 14 days)`);
    onCreated();
  }

  return (
    <form onSubmit={handleCreate} className="rounded-lg border border-primary/30 bg-surface p-4 space-y-3">
      <div className="text-xs font-semibold text-primary mb-1">New Company</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Company Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setSlug(toSlug(e.target.value)); }}
            required
            placeholder="Acme Logistics Ltd"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Slug (URL-safe)</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(toSlug(e.target.value))}
            required
            placeholder="acme-logistics"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Starting Plan</label>
        <div className="mt-1 flex gap-2">
          {(["starter", "pro", "enterprise"] as CompanyPlan[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlan(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors capitalize ${
                plan === p ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? "Creating…" : "Create Company"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
