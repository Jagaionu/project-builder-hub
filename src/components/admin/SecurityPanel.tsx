/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getRecoveryCodesStatus,
  regenerateRecoveryCodes,
  getSuperAdminAudit,
  getMyRecentLogins,
} from "@/lib/security/security.functions";

export function SecurityPanel() {
  const statusFn = useServerFn(getRecoveryCodesStatus);
  const regenFn = useServerFn(regenerateRecoveryCodes);
  const auditFn = useServerFn(getSuperAdminAudit);
  const loginsFn = useServerFn(getMyRecentLogins);

  const [remaining, setRemaining] = useState<number | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [logins, setLogins] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, l, a] = await Promise.all([
      statusFn({ data: {} }),
      loginsFn({ data: {} }),
      auditFn({ data: { limit: 100 } }),
    ]);
    setRemaining((s as any).remaining);
    setLogins(l as any[]);
    setAudit(a as any[]);
  }, [statusFn, loginsFn, auditFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const regen = async () => {
    if (!window.confirm("Regenerate recovery codes? This invalidates your previous set.")) return;
    setBusy(true);
    try {
      const r = (await regenFn({ data: {} })) as { codes: string[] };
      setCodes(r.codes);
      await load();
      toast.success("New recovery codes generated - save them now");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const logoutOthers = async () => {
    setBusy(true);
    try {
      await supabase.auth.signOut({ scope: "others" } as any);
      toast.success("Signed out all other sessions");
    } catch {
      toast.error("Could not sign out other sessions");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Recovery codes</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {remaining === null ? "..." : remaining + " unused code(s) remaining"} - used if you lose your authenticator.
            </p>
          </div>
          <button onClick={regen} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:opacity-50">
            Regenerate
          </button>
        </div>
        {codes.length > 0 && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-background border border-border p-3 font-mono text-sm">
            {codes.map((c) => (<div key={c}>{c}</div>))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Recent sign-ins</h3>
          <button onClick={logoutOthers} disabled={busy} className="rounded-lg border border-destructive/50 text-destructive px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10 disabled:opacity-50">
            Log out all other sessions
          </button>
        </div>
        <div className="divide-y divide-border text-xs">
          {logins.length === 0 ? (
            <p className="text-muted-foreground">No recent sign-ins recorded.</p>
          ) : (
            logins.map((l, i) => (
              <div key={i} className="py-2 flex items-center justify-between gap-3">
                <span>{[l.city, l.country].filter(Boolean).join(", ") || "unknown"} - {l.ip ?? "?"}</span>
                <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleString()}{l.suspicious ? " - flagged" : ""}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <h3 className="text-sm font-semibold">Audit log</h3>
        <div className="max-h-96 overflow-y-auto divide-y divide-border text-[11px] font-mono">
          {audit.length === 0 ? (
            <p className="text-muted-foreground">No audit entries yet.</p>
          ) : (
            audit.map((a, i) => (
              <div key={i} className="py-1.5">
                <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
                {" - "}<span className="text-primary">{a.category}</span>
                {" / "}{a.action}
                {a.actorEmail ? " - " + a.actorEmail : ""}
                {a.ip ? " - " + a.ip : ""}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
