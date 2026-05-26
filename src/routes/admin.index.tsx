import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Company, SubscriptionStatus, CompanyPlan, TenantConfig, TenantModule } from "@/lib/types";
import { DEFAULT_TENANT_CONFIG } from "@/lib/types";
import { createCompanyAdmin, listCompanyMembers } from "@/lib/admin-users.functions";
import {
  CheckCircle, XCircle, Clock, Ban,
  Plus, ChevronDown, ChevronUp, Save, UserPlus, Copy,
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

const ALL_MODULES: ReadonlyArray<TenantModule> = ["dispatch", "jobs", "drivers", "warehouses", "alerts", "events"];

function AdminDashboard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  async function loadCompanies() {
    const { data, error } = await supabase
      .from("companies" as never)
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setCompanies(data as unknown as Company[]);
    setLoading(false);
  }

  useEffect(() => { loadCompanies(); }, []);

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
    return <div className="p-6 text-sm text-muted-foreground font-mono">Loading companies…</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-lg font-semibold">Companies</h1>
          <p className="text-xs text-muted-foreground">{companies.length} total</p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" /> New Company
        </button>
      </div>

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
  const [lastCreated, setLastCreated] = useState<{ email: string; password: string } | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; user_id: string; role: string; email: string | null; password: string | null }>>([]);
  const createAdmin = useServerFn(createCompanyAdmin);
  const fetchMembers = useServerFn(listCompanyMembers);

  const derivedEmail = `${company.slug}@admin.local`;

  useEffect(() => {
    if (!expanded) return;
    fetchMembers({ data: { companyId: company.id } })
      .then((r) => setMembers(r as typeof members))
      .catch(() => {});
  }, [expanded, company.id, fetchMembers, lastCreated]);

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
      toast.success(`Admin credentials generated for ${company.name}`);
      setLastCreated({ email: derivedEmail, password });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  async function copyCreds() {
    if (!lastCreated) return;
    await navigator.clipboard.writeText(`Email: ${lastCreated.email}\nPassword: ${lastCreated.password}`);
    toast.success("Credentials copied to clipboard");
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

          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Enabled Modules</div>
            <div className="flex flex-wrap gap-2">
              {ALL_MODULES.map((mod) => (
                <button
                  key={mod}
                  onClick={() => toggleModule(mod)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors capitalize ${
                    config.modules.includes(mod)
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border/50 text-muted-foreground/50 hover:text-muted-foreground"
                  }`}
                >
                  {mod}
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
                { key: "showTelegramAlerts" as const, label: "Telegram Alerts integration" },
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

          <div className="border-t border-border pt-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Admin Login</div>
            <div className="rounded-md border border-border bg-surface-2/30 p-3 space-y-2">
              <div className="text-xs">
                <span className="text-muted-foreground">Login email:</span>{" "}
                <span className="font-mono select-all">{derivedEmail}</span>
              </div>
              {members.length > 0 ? (
                <div className="space-y-1.5">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-3 text-xs font-mono py-1.5">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground shrink-0">Password:</span>
                        {m.password ? (
                          <span className="select-all text-foreground/90 truncate">{m.password}</span>
                        ) : (
                          <span className="text-muted-foreground/60 italic">not on file — regenerate to set</span>
                        )}
                      </span>
                      {m.password && (
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(m.password!);
                            toast.success("Password copied");
                          }}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                        >
                          <Copy className="size-3" /> Copy
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No admin yet. Generate credentials to create the company's login.
                </p>
              )}
              <button
                type="button"
                onClick={handleGenerateCredentials}
                disabled={creating}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <UserPlus className="size-4" />
                {creating ? "Working…" : members.length > 0 ? "Regenerate password" : "Generate credentials"}
              </button>
            </div>
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
    const { error } = await supabase.from("companies" as never).insert({
      name: name.trim(),
      slug: slug.trim() || toSlug(name),
      plan,
      subscription_status: "trial",
    } as never);
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success(`Company "${name}" created`);
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
