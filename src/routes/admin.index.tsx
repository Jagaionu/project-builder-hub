import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Company, SubscriptionStatus, Warehouse } from "@/lib/types";
import { Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AdminSupportPanel } from "@/components/admin/AdminSupportPanel";
const AdminAnalytics = lazy(() =>
  import("@/components/admin/AdminAnalytics").then((m) => ({ default: m.AdminAnalytics })),
);
import { AdminBilling } from "@/components/admin/AdminBilling";
import { AdminAIInsights } from "@/components/admin/AdminAIInsights";
import { AdminDeviceApprovals } from "@/components/admin/AdminDeviceApprovals";
import { StatsBar, StatsBarSkeleton } from "@/routes/admin/stats-bar";
import { SearchFilterBar } from "@/routes/admin/search-filter-bar";
import { CompanyCard, CompanyCardSkeleton } from "@/routes/admin/company-card";
import { CreateCompanyDialog } from "@/routes/admin/create-company-dialog";
import { WarehouseTable } from "@/routes/admin/warehouse-table";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

type CompanyUsage = {
  drivers: number;
  warehouses: number;
  members: number;
  vrids30d: number;
  activity14d: number;
  lastActive: number | null;
};

function useCompanyUsage(): Record<string, CompanyUsage> {
  const [usage, setUsage] = useState<Record<string, CompanyUsage>>({});
  useEffect(() => {
    let cancelled = false;
    const sb = supabase as unknown as { from: (t: string) => any };
    const now = Date.now();
    const d30 = new Date(now - 30 * 86_400_000).toISOString();
    const d14 = new Date(now - 14 * 86_400_000).toISOString();
    void (async () => {
      const [drv, wh, mem, jobs, act] = await Promise.all([
        sb.from("drivers").select("tenant_id, deleted_at"),
        sb.from("warehouses").select("tenant_id"),
        sb.from("company_members").select("company_id"),
        sb.from("jobs").select("tenant_id, created_at").gte("created_at", d30),
        sb.from("activity_log").select("tenant_id, created_at").gte("created_at", d14),
      ]);
      if (cancelled) return;
      const m: Record<string, CompanyUsage> = {};
      const g = (id: string | null | undefined) =>
        id
          ? (m[id] ||= {
              drivers: 0,
              warehouses: 0,
              members: 0,
              vrids30d: 0,
              activity14d: 0,
              lastActive: null,
            })
          : null;
      const touch = (u: CompanyUsage, iso: string) => {
        const t = +new Date(iso);
        if (t && (!u.lastActive || t > u.lastActive)) u.lastActive = t;
      };
      for (const r of (drv.data ?? []) as Array<{
        tenant_id: string | null;
        deleted_at: string | null;
      }>)
        if (!r.deleted_at) {
          const u = g(r.tenant_id);
          if (u) u.drivers++;
        }
      for (const r of (wh.data ?? []) as Array<{ tenant_id: string | null }>) {
        const u = g(r.tenant_id);
        if (u) u.warehouses++;
      }
      for (const r of (mem.data ?? []) as Array<{ company_id: string | null }>) {
        const u = g(r.company_id);
        if (u) u.members++;
      }
      for (const r of (jobs.data ?? []) as Array<{
        tenant_id: string | null;
        created_at: string;
      }>) {
        const u = g(r.tenant_id);
        if (u) {
          u.vrids30d++;
          touch(u, r.created_at);
        }
      }
      for (const r of (act.data ?? []) as Array<{ tenant_id: string | null; created_at: string }>) {
        const u = g(r.tenant_id);
        if (u) {
          u.activity14d++;
          touch(u, r.created_at);
        }
      }
      setUsage(m);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return usage;
}

function AdminDashboard() {
  const [tab, setTab] = useState<
    "companies" | "warehouses" | "support" | "billing" | "ai" | "devices"
  >("companies");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [showAddWarehouse, setShowAddWarehouse] = useState(false);
  const [newWarehouse, setNewWarehouse] = useState({
    code: "",
    name: "",
    latitude: "",
    longitude: "",
    address: "",
  });
  const [companySearch, setCompanySearch] = useState("");
  const [companyStatusFilter, setCompanyStatusFilter] = useState<SubscriptionStatus | "all">("all");
  const [warehouseSearch, setWarehouseSearch] = useState("");

  const usage = useCompanyUsage();
  const totals = useMemo(() => {
    let drivers = 0,
      vrids = 0,
      activity = 0;
    for (const c of companies) {
      const u = usage[c.id];
      if (u) {
        drivers += u.drivers;
        vrids += u.vrids30d;
        activity += u.activity14d;
      }
    }
    return { drivers, vrids, activity };
  }, [companies, usage]);

  // Companies that cancelled in the last 7 days - a churn signal for the super admin.
  const recentlyCancelled = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return companies
      .filter(
        (c) =>
          c.subscription_status === "cancelled" &&
          c.subscription_ends_at &&
          new Date(c.subscription_ends_at).getTime() >= cutoff,
      )
      .sort(
        (a, b) =>
          new Date(b.subscription_ends_at as string).getTime() -
          new Date(a.subscription_ends_at as string).getTime(),
      );
  }, [companies]);

  async function loadCompanies() {
    const { data, error } = await supabase
      .from("companies" as never)
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setCompanies(data as unknown as Company[]);
    else if (error) toast.error("Failed to load companies");
  }

  async function loadWarehouses() {
    const { data, error } = await supabase
      .from("warehouses" as never)
      .select("*, companies(name)")
      .order("code", { ascending: true });
    if (!error && data) setWarehouses(data as unknown as Warehouse[]);
    else if (error) toast.error("Failed to load warehouses");
  }

  useEffect(() => {
    Promise.all([loadCompanies(), loadWarehouses()]).finally(() => setLoading(false));
  }, []);

  async function updateStatus(id: string, status: SubscriptionStatus) {
    const { error } = await supabase
      .from("companies" as never)
      .update({ subscription_status: status } as never)
      .eq("id", id);
    if (error) {
      toast.error("Failed to update status");
      return;
    }
    toast.success("Status updated to " + status);
    loadCompanies();
  }

  async function updateConfig(id: string, config: any) {
    const { error } = await supabase
      .from("companies" as never)
      .update({ config } as never)
      .eq("id", id);
    if (error) {
      toast.error("Failed to save config");
      return;
    }
    toast.success("Config saved");
    loadCompanies();
  }

  const filteredCompanies = useMemo(() => {
    return companies.filter((c) => {
      if (companyStatusFilter !== "all" && c.subscription_status !== companyStatusFilter)
        return false;
      if (!companySearch) return true;
      const q = companySearch.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q);
    });
  }, [companies, companySearch, companyStatusFilter]);

  const handleCompanySearch = useCallback((q: string) => setCompanySearch(q), []);
  const handleCompanyStatusFilter = useCallback(
    (s: SubscriptionStatus | "all") => setCompanyStatusFilter(s),
    [],
  );
  const handleWarehouseSearch = useCallback((q: string) => setWarehouseSearch(q), []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <div className="skeleton h-5 w-36 rounded mb-1" />
          <div className="skeleton h-3 w-24 rounded" />
        </div>
        <StatsBarSkeleton />
        <div className="flex gap-2 border-b border-border">
          <div className="skeleton h-9 w-24 rounded-t-md" />
          <div className="skeleton h-9 w-32 rounded-t-md" />
        </div>
        <div className="grid grid-cols-1 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CompanyCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-semibold">Admin Dashboard</h1>
        <p className="text-[11px] text-muted-foreground">Platform management</p>
      </div>

      <StatsBar companies={companies} />

      {recentlyCancelled.length > 0 && (
        <button
          onClick={() => {
            setTab("companies");
            setCompanyStatusFilter("cancelled");
          }}
          className="w-full text-left rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 hover:bg-destructive/10 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <XCircle className="size-4" />
            {recentlyCancelled.length} compan{recentlyCancelled.length === 1 ? "y" : "ies"} cancelled
            in the last 7 days
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {recentlyCancelled
              .slice(0, 4)
              .map((c) => c.name + " (" + new Date(c.subscription_ends_at as string).toLocaleDateString() + ")")
              .join(", ")}
            {recentlyCancelled.length > 4 ? " and more" : ""}. Click to review.
          </div>
        </button>
      )}

      <div className="flex gap-1 border-b border-border">
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
        <button
          onClick={() => setTab("support")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "support"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Support
        </button>
        <button
          onClick={() => setTab("billing")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "billing"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Billing
        </button>
        <button
          onClick={() => setTab("ai")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "ai"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          AI Insights
        </button>
        <button
          onClick={() => setTab("devices")}
          className={
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors " +
            (tab === "devices"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground")
          }
        >
          Devices
        </button>
      </div>

      {tab === "support" && <AdminSupportPanel companies={companies} />}

      {tab === "billing" && <AdminBilling companies={companies} />}

      {tab === "ai" && <AdminAIInsights companies={companies} />}

      {tab === "devices" && <AdminDeviceApprovals />}

      {tab === "companies" && (
        <>
          <SearchFilterBar
            onSearch={handleCompanySearch}
            onStatusFilter={handleCompanyStatusFilter}
            activeStatus={companyStatusFilter}
            searchPlaceholder="Search companies..."
            actions={
              <Button size="sm" onClick={() => setShowCreateCompany(true)}>
                <Plus className="size-3.5" />
                New Company
              </Button>
            }
          />

          <Suspense
            fallback={
              <div className="h-72 grid place-items-center text-xs text-muted-foreground">
                Loading analytics…
              </div>
            }
          >
            <AdminAnalytics companies={companies} usage={usage} />
          </Suspense>

          <CreateCompanyDialog
            open={showCreateCompany}
            onOpenChange={setShowCreateCompany}
            onCreated={() => loadCompanies()}
          />

          {filteredCompanies.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">
                {companySearch || companyStatusFilter !== "all"
                  ? "No companies match your filters"
                  : "No companies yet. Create your first one."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredCompanies.map((company) => (
                <CompanyCard
                  key={company.id}
                  company={company}
                  expanded={expandedId === company.id}
                  onToggle={() => setExpandedId(expandedId === company.id ? null : company.id)}
                  onStatusChange={updateStatus}
                  onConfigSave={updateConfig}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "warehouses" && (
        <>
          <SearchFilterBar
            onSearch={handleWarehouseSearch}
            onStatusFilter={() => {}}
            activeStatus="all"
            searchPlaceholder="Search by code or name..."
            actions={
              <Button size="sm" onClick={() => setShowAddWarehouse(!showAddWarehouse)}>
                <Plus className="size-3.5" />
                Add Warehouse
              </Button>
            }
          />

          {showAddWarehouse && (
            <div className="rounded-lg border border-primary/30 bg-surface p-4 space-y-3">
              <div className="text-xs font-semibold text-primary">New Warehouse</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Code
                  </label>
                  <input
                    type="text"
                    value={newWarehouse.code}
                    onChange={(e) => setNewWarehouse((p) => ({ ...p, code: e.target.value }))}
                    placeholder="BHX2"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Name
                  </label>
                  <input
                    type="text"
                    value={newWarehouse.name}
                    onChange={(e) => setNewWarehouse((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Birmingham Hub"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={newWarehouse.latitude}
                    onChange={(e) => setNewWarehouse((p) => ({ ...p, latitude: e.target.value }))}
                    placeholder="52.5"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={newWarehouse.longitude}
                    onChange={(e) => setNewWarehouse((p) => ({ ...p, longitude: e.target.value }))}
                    placeholder="-1.9"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Address (optional)
                </label>
                <input
                  type="text"
                  value={newWarehouse.address}
                  onChange={(e) => setNewWarehouse((p) => ({ ...p, address: e.target.value }))}
                  placeholder="123 Logistics Way, Birmingham"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!newWarehouse.code || !newWarehouse.name) {
                      toast.error("Code and name are required");
                      return;
                    }
                    const lat = parseFloat(newWarehouse.latitude);
                    const lon = parseFloat(newWarehouse.longitude);
                    if (isNaN(lat) || isNaN(lon)) {
                      toast.error("Invalid coordinates");
                      return;
                    }
                    const { error } = await supabase.from("warehouses" as never).insert({
                      code: newWarehouse.code.trim(),
                      name: newWarehouse.name.trim(),
                      latitude: lat,
                      longitude: lon,
                      address: newWarehouse.address.trim() || null,
                    } as never);
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    toast.success('Warehouse "' + newWarehouse.name + '" created');
                    setNewWarehouse({
                      code: "",
                      name: "",
                      latitude: "",
                      longitude: "",
                      address: "",
                    });
                    setShowAddWarehouse(false);
                    loadWarehouses();
                  }}
                >
                  Create Warehouse
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddWarehouse(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <WarehouseTable
            warehouses={warehouses}
            searchQuery={warehouseSearch}
            onRefresh={loadWarehouses}
          />
        </>
      )}
    </div>
  );
}
