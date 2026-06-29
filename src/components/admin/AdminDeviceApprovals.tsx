import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listDevicesForReview,
  setDeviceStatus,
  listSuspiciousLogins,
} from "@/lib/device.functions";
import { toast } from "sonner";
import { Check, X, Smartphone, ShieldCheck, AlertTriangle } from "lucide-react";

type Suspicious = {
  id: string;
  when: string;
  reason: string | null;
  ip: string | null;
  place: string;
  companyName: string;
  who: string;
};

type Row = {
  id: string;
  status: string;
  label: string | null;
  deviceId: string;
  firstSeen: string;
  lastSeen: string;
  companyName: string;
  memberName: string | null;
  email: string | null;
};

export function AdminDeviceApprovals() {
  const list = useServerFn(listDevicesForReview);
  const setStatus = useServerFn(setDeviceStatus);
  const listSus = useServerFn(listSuspiciousLogins);
  const [rows, setRows] = useState<Row[]>([]);
  const [suspicious, setSuspicious] = useState<Suspicious[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    list({ data: {} })
      .then((r) => setRows(r as Row[]))
      .catch(() => toast.error("Failed to load devices"))
      .finally(() => setLoading(false));
    listSus({ data: {} })
      .then((r) => setSuspicious(r as Suspicious[]))
      .catch(() => {});
  }, [list, listSus]);
  useEffect(() => load(), [load]);

  const act = async (id: string, status: "approved" | "revoked") => {
    setBusy(id);
    try {
      await setStatus({ data: { id, status } });
      toast.success(status === "approved" ? "Device approved" : "Device revoked");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const pending = rows.filter((r) => r.status === "pending");
  const others = rows.filter((r) => r.status !== "pending");

  const who = (r: Row) => r.memberName || r.email || "—";
  const when = (iso: string) => new Date(iso).toLocaleString();

  const RowItem = ({ r }: { r: Row }) => (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Smartphone className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{who(r)}</span>
          <span className="text-[11px] text-muted-foreground">· {r.companyName}</span>
          {r.status === "approved" && (
            <span className="text-[10px] font-mono uppercase text-emerald-600 dark:text-emerald-400">
              approved
            </span>
          )}
          {r.status === "revoked" && (
            <span className="text-[10px] font-mono uppercase text-destructive">revoked</span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          {r.label ?? "Unknown device"} · first seen {when(r.firstSeen)}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {r.status !== "approved" && (
          <button
            disabled={busy === r.id}
            onClick={() => act(r.id, "approved")}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
          >
            <Check className="size-3" /> Approve
          </button>
        )}
        {r.status !== "revoked" && (
          <button
            disabled={busy === r.id}
            onClick={() => act(r.id, "revoked")}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <X className="size-3" /> Revoke
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Device approvals</h2>
        {pending.length > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
            {pending.length} pending
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Each login auto-approves up to 2 devices; further devices are held here until you approve
        them. This catches one set of credentials being shared across many people.
      </p>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Pending ({pending.length})
            </div>
            {pending.length === 0 ? (
              <div className="text-xs text-muted-foreground">No devices awaiting approval.</div>
            ) : (
              pending.map((r) => <RowItem key={r.id} r={r} />)
            )}
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              All devices ({others.length})
            </div>
            {others.map((r) => (
              <RowItem key={r.id} r={r} />
            ))}
          </div>

          {suspicious.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                Suspicious logins ({suspicious.length})
              </div>
              <p className="text-[11px] text-muted-foreground">
                Impossible-travel signals (same login seen in distant places too quickly). Often a
                shared account or a VPN — review alongside the device list.
              </p>
              {suspicious.map((s) => (
                <div
                  key={s.id}
                  className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.who}</span>
                    <span className="text-[11px] text-muted-foreground">· {s.companyName}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {s.reason ?? "Anomaly"} · {s.place}
                    {s.ip ? " · " + s.ip : ""} · {new Date(s.when).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
