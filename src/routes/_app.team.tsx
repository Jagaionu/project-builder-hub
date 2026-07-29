import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTenant } from "@/lib/tenant-context";
import {
  listCompanyMembers,
  createCompanyProfile,
  resetProfilePassword,
  deleteProfile,
} from "@/lib/admin-users.functions";
import { PageHeader } from "./_app.index";
import { toast } from "sonner";
import { useTeamSync } from "@/lib/use-team-sync";
import { entitlementsForPlan } from "@/lib/billing/plan-entitlements";
import { getPlanOptions } from "@/lib/billing/billing.functions";
import { UserPlus, Copy, Trash2, Key, Shield, User } from "lucide-react";

export const Route = createFileRoute("/_app/team")({ component: TeamPage });

type Member = {
  id: string;
  user_id: string;
  role: string;
  name: string | null;
  must_set_password: boolean;
  email: string | null;
  password: string | null;
  created_at: string;
};

// Synthetic logins are name@{slug}.team; show the short name@slug form.
function shortLogin(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at < 0) return email;
  return email.slice(0, at) + "@" + email.slice(at + 1).split(".")[0];
}

function TeamPage() {
  const { role, company } = useTenant();
  const navigate = useNavigate();
  useEffect(() => {
    if (role !== "admin") navigate({ to: "/", replace: true });
  }, [role, navigate]);

  const fetchMembers = useServerFn(listCompanyMembers);
  const addProfile = useServerFn(createCompanyProfile);
  const resetPwd = useServerFn(resetProfilePassword);
  const delProfile = useServerFn(deleteProfile);
  const fetchPlanOptions = useServerFn(getPlanOptions);

  const [members, setMembers] = useState<Member[]>([]);
  const [seatCaps, setSeatCaps] = useState<Record<string, number> | null>(null);
  const [profileName, setProfileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{
    name: string;
    email: string;
    tempPassword: string;
  } | null>(null);

  const load = useCallback(() => {
    fetchMembers({ data: { companyId: company.id } })
      .then((r) => setMembers(r as Member[]))
      .catch(() => toast.error("Failed to load profiles"));
  }, [fetchMembers, company.id]);
  const notifyTeam = useTeamSync(company.id, role === "admin", load);
  useEffect(() => {
    if (role === "admin") load();
  }, [role, load]);
  useEffect(() => {
    if (role !== "admin") return;
    fetchPlanOptions({ data: {} })
      .then((rows) => {
        const m: Record<string, number> = {};
        for (const r of rows as Array<{ plan: string; maxSeats: number }>) m[r.plan] = r.maxSeats;
        setSeatCaps(m);
      })
      .catch(() => {});
  }, [role, fetchPlanOptions]);

  if (role !== "admin") return null;

  const regulars = members.filter((m) => m.role !== "admin");
  const rawPlan = (company as { plan?: string }).plan ?? "starter";
  const planTier = rawPlan === "pro" || rawPlan === "enterprise" ? rawPlan : "starter";
  const maxSeats = seatCaps?.[planTier] ?? entitlementsForPlan(planTier).maxSeats;
  const seatsUsed = members.length;
  const seatsFull = seatsUsed >= maxSeats;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Team"
        subtitle={`${regulars.length} profile${regulars.length === 1 ? "" : "s"}`}
      />

      <div className="flex-1 overflow-y-auto p-5 max-w-2xl w-full mx-auto space-y-4">
        {/* Add profile */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Add a profile
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Create a login for a team member. They sign in by picking their name on this device and
            entering the one-time password you hand them (they set their own on first login).
          </p>
          <div className="mb-3 text-xs">
            <span
              className={seatsFull ? "font-semibold text-destructive" : "text-muted-foreground"}
            >
              {seatsUsed} of {maxSeats} seats used
            </span>
            {seatsFull && (
              <span className="text-muted-foreground">
                {" "}
                — seat limit reached for your {planTier} plan. Remove a member or upgrade your plan
                to add more.
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Associate name (e.g. Jane Smith)"
              className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              disabled={busy || !profileName.trim() || seatsFull}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = (await addProfile({
                    data: { companyId: company.id, name: profileName.trim() },
                  })) as { name: string; email: string; tempPassword: string };
                  setIssued(r);
                  setProfileName("");
                  toast.success(`Profile "${r.name}" created`);
                  load();
                  notifyTeam();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Create failed");
                } finally {
                  setBusy(false);
                }
              }}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              data-ai-target="add-profile"
            >
              <UserPlus className="size-4" /> Add profile
            </button>
          </div>

          {issued && (
            <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <div className="text-[10px] font-mono uppercase tracking-widest text-primary mb-1">
                One-time credentials — copy now
              </div>
              <div className="font-mono break-all">{shortLogin(issued.email)}</div>
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
        </div>

        {/* Member list */}
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <User className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground">Profiles</span>
          </div>
          {regulars.length > 0 ? (
            <div className="p-3 space-y-1.5">
              {regulars.map((m) => (
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
                        {m.name ?? shortLogin(m.email) ?? m.user_id.slice(0, 8)}
                      </span>
                      {m.must_set_password && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-warning/10 text-warning border border-warning/20">
                          PENDING
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground truncate mt-0.5 ml-8">
                      {shortLogin(m.email)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {m.password && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(m.password!);
                          toast.success("Password copied");
                        }}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Copy className="size-3" /> Copy
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = (await resetPwd({ data: { memberId: m.id } })) as {
                            tempPassword: string;
                          };
                          setIssued({
                            name: m.name ?? m.email ?? "",
                            email: m.email ?? "",
                            tempPassword: r.tempPassword,
                          });
                          toast.success("Password reset — copy the new credentials above");
                          load();
                          notifyTeam();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Reset failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      <Key className="size-3" /> Reset
                    </button>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (!confirm(`Remove "${m.name ?? m.email}"? This deletes their login.`))
                          return;
                        setBusy(true);
                        try {
                          await delProfile({ data: { memberId: m.id } });
                          toast.success("Profile removed");
                          load();
                          notifyTeam();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Remove failed");
                        } finally {
                          setBusy(false);
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
            <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              No profiles yet. Add one above.
            </div>
          )}
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Shield className="size-3.5 text-primary" /> You are the company admin — only you can
          manage profiles, Events and Billing.
        </p>
      </div>
    </div>
  );
}
