import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDrivers, useComplianceWithLedger, useDriverDayHours, type DriverDayHours } from "@/lib/hooks";
import { getDriversSnapshot } from "@/lib/drivers.functions";
import type { Compliance } from "@/lib/compliance";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "./_app.index";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X, KeyRound, UserPlus } from "lucide-react";
import { generatePairingCode } from "@/lib/telegram-notify.functions";
import { approveRegistration, rejectRegistration } from "@/lib/registrations.functions";

export const Route = createFileRoute("/_app/drivers")({
  loader: () => getDriversSnapshot(),
  component: DriversPage,
  head: () => ({ meta: [{ title: "Drivers — Planning System" }] }),
});

type DriverForm = { name: string; phone: string; telegram_id: string };

function formatStableTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss} UTC`;
}

function formatStableDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${formatStableTime(iso)}`;
}

function formatLedgerDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, date));
  const weekday = utcDate.toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${weekday} ${String(date).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

function DriversPage() {
  const { drivers: initialDrivers } = Route.useLoaderData();
  const drivers = useDrivers(initialDrivers);
  const driverDayHours = useDriverDayHours();
  const compliance = useComplianceWithLedger(driverDayHours);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DriverForm>({ name: "", phone: "", telegram_id: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DriverForm>({ name: "", phone: "", telegram_id: "" });

  async function add() {
    if (!form.name) return toast.error("Name required");
    const { error } = await supabase.from("drivers").insert({
      name: form.name,
      phone: form.phone || null,
      telegram_id: form.telegram_id || null,
      status: "OFF_SHIFT",
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Driver added");
      setOpen(false);
      setForm({ name: "", phone: "", telegram_id: "" });
    }
  }

  function startEdit(d: { id: string; name: string; phone: string | null; telegram_id: string | null }) {
    setEditingId(d.id);
    setEditForm({ name: d.name, phone: d.phone ?? "", telegram_id: d.telegram_id ?? "" });
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.name) return toast.error("Name required");
    const { error } = await supabase
      .from("drivers")
      .update({
        name: editForm.name,
        phone: editForm.phone || null,
        telegram_id: editForm.telegram_id || null,
      })
      .eq("id", editingId);
    if (error) toast.error(error.message);
    else {
      toast.success("Driver updated");
      setEditingId(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete driver "${name}"?`)) return;
    const { error } = await supabase.from("drivers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Driver deleted");
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Drivers"
        subtitle={`${drivers.length} drivers in roster`}
        right={
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium"
          >
            <Plus className="size-3.5" /> New Driver
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {open && (
          <div className="rounded-md border border-border bg-surface p-4 grid grid-cols-4 gap-3 items-end">
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field
              label="Telegram ID"
              value={form.telegram_id}
              onChange={(v) => setForm({ ...form, telegram_id: v })}
            />
            <button onClick={add} className="h-9 px-3 rounded bg-primary text-primary-foreground text-sm">
              Create
            </button>
          </div>
        )}
        <PendingRegistrations />

        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Telegram</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Compliance (UK HGV)</th>
                <th className="px-3 py-2 text-left">Last Update</th>
                <th className="px-3 py-2 text-right">Coords</th>
                <th className="px-3 py-2 text-right w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {drivers.map((d) => {
                const isEditing = editingId === d.id;
                return (
                  <tr key={d.id} className="hover:bg-surface-2/40">
                    <td className="px-3 py-2.5">
                      {isEditing ? (
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="h-8 px-2 rounded bg-background border border-border text-sm w-full focus:outline-none focus:border-primary"
                        />
                      ) : (
                        d.name
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {isEditing ? (
                        <input
                          value={editForm.phone}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="h-8 px-2 rounded bg-background border border-border text-xs w-full focus:outline-none focus:border-primary"
                        />
                      ) : (
                        (d.phone ?? "—")
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {isEditing ? (
                        <input
                          value={editForm.telegram_id}
                          onChange={(e) => setEditForm({ ...editForm, telegram_id: e.target.value })}
                          className="h-8 px-2 rounded bg-background border border-border text-xs w-full focus:outline-none focus:border-primary"
                        />
                      ) : (
                        (d.telegram_id ?? "—")
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={d.status} kind="driver" />
                    </td>
                    <td className="px-3 py-2.5">
                      <ComplianceCell c={compliance[d.id]} rows={driverDayHours[d.id] ?? []} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatStableTime(d.last_update_time)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {d.current_lat != null ? `${d.current_lat.toFixed(3)}, ${d.current_lon?.toFixed(3)}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={saveEdit}
                              className="p-1.5 rounded hover:bg-surface-2 text-primary"
                              title="Save"
                            >
                              <Check className="size-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground"
                              title="Cancel"
                            >
                              <X className="size-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <PairButton driverId={d.id} hasTelegram={!!d.telegram_id} />
                            <button
                              onClick={() => startEdit(d)}
                              className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground"
                              title="Edit"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              onClick={() => remove(d.id, d.name)}
                              className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-9 px-2.5 rounded bg-background border border-border text-sm focus:outline-none focus:border-primary"
      />
    </label>
  );
}


function PairButton({ driverId, hasTelegram }: { driverId: string; hasTelegram: boolean }) {
  const gen = useServerFn(generatePairingCode);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await gen({ data: { driverId } });
      await navigator.clipboard?.writeText(r.code).catch(() => {});
      toast.success(`Code ${r.code} — valid 15 min (copied)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={run}
      disabled={busy}
      title={hasTelegram ? "Re-pair Telegram" : "Generate pairing code"}
      className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-primary disabled:opacity-50"
    >
      <KeyRound className="size-3.5" />
    </button>
  );
}

type Registration = {
  id: string;
  telegram_id: string;
  name: string | null;
  phone: string | null;
  status: "AWAITING_NAME" | "AWAITING_PHONE" | "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
};

function PendingRegistrations() {
  const [regs, setRegs] = useState<Registration[]>([]);
  const approve = useServerFn(approveRegistration);
  const reject = useServerFn(rejectRegistration);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = () =>
      supabase
        .from("driver_registrations")
        .select("*")
        .eq("status", "PENDING")
        .order("created_at", { ascending: false })
        .then(({ data }) => {
          if (mounted && data) setRegs(data as Registration[]);
        });
    load();
    const ch = supabase
      .channel("rt-registrations")
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_registrations" }, load)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);

  async function onApprove(id: string) {
    setBusyId(id);
    try {
      await approve({ data: { registrationId: id } });
      toast.success("Driver approved & notified");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(id: string) {
    const reason = prompt("Optional reason for rejection?") ?? undefined;
    setBusyId(id);
    try {
      await reject({ data: { registrationId: id, reason: reason || undefined } });
      toast.success("Registration rejected");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (regs.length === 0) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 overflow-hidden">
      <div className="px-3 py-2 bg-warning/10 text-[10px] font-mono uppercase tracking-widest text-warning flex items-center gap-1.5">
        <UserPlus className="size-3.5" /> Pending registrations · {regs.length}
      </div>
      <table className="w-full text-sm">
        <thead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Phone</th>
            <th className="px-3 py-2 text-left">Telegram ID</th>
            <th className="px-3 py-2 text-left">Submitted</th>
            <th className="px-3 py-2 text-right w-40">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {regs.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2.5">{r.name ?? "—"}</td>
              <td className="px-3 py-2.5 font-mono text-xs">{r.phone ?? "—"}</td>
              <td className="px-3 py-2.5 font-mono text-xs">{r.telegram_id}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                {formatStableDateTime(r.created_at)}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    disabled={busyId === r.id}
                    onClick={() => onApprove(r.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
                  >
                    <Check className="size-3" /> Approve
                  </button>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => onReject(r.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-xs hover:bg-surface-2 disabled:opacity-50"
                  >
                    <X className="size-3" /> Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function ComplianceCell({ c, rows }: { c: Compliance | undefined; rows: DriverDayHours[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 320;
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      setPos({ top: r.bottom + 4, left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  if (!c) {
    return <span className="text-[11px] text-muted-foreground/50">—</span>;
  }
  const dot =
    c.status === "breach" ? "bg-destructive" : c.status === "warn" ? "bg-warning" : "bg-success";
  const ring =
    c.status === "breach"
      ? "border-destructive/40 text-destructive hover:bg-destructive/5"
      : c.status === "warn"
        ? "border-warning/40 text-warning hover:bg-warning/5"
        : "border-success/30 text-success hover:bg-success/5";

  const tightest = Math.min(c.dailyHeadroom, c.weeklyHeadroom);
  const label =
    c.status === "breach" ? "Breach" : c.status === "warn" ? "Warning" : `${tightest.toFixed(1)}h left`;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${ring}`}
      >
        <span className={`size-1.5 rounded-full ${dot}`} />
        <span className="uppercase tracking-wider text-[10px] font-mono">{c.status}</span>
        <span className="opacity-70">· {label}</span>
        {c.issues.length > 0 && (
          <span className="ml-0.5 rounded-full bg-foreground/10 px-1 text-[9px] font-mono">
            {c.issues.length}
          </span>
        )}
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[101] w-80 rounded-md border border-border bg-surface shadow-lg p-3 space-y-3"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                UK HGV hours
              </div>
              <div className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase ${ring}`}>
                <span className={`size-1.5 rounded-full ${dot}`} />
                {c.status}
                {c.onShift && <span className="opacity-60">· on shift</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <Metric label="Today (24h)" value={c.daily} cap={10} unit="h" hint="Max 9h, 10h up to 2×/wk" />
              <Metric label="This week" value={c.weekly} cap={56} unit="h" hint="56h rolling 7 days" />
              <Metric label="Fortnight" value={c.twoWeek} cap={90} unit="h" hint="90h rolling 14 days" />
              {c.onShift ? (
                <Metric label="Drive cycle" value={c.continuousDrive} cap={4.5} unit="h" hint="45min break after 4.5h" />
              ) : (
                <Metric label="Rest taken" value={Math.min(c.restHours, 24)} cap={11} unit="h" hint="11h normal, 9h reduced" />
              )}
            </div>

            {c.issues.length > 0 ? (
              <div className="space-y-1 border-t border-border pt-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Issues
                </div>
                {c.issues.map((i, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-1.5 text-xs ${i.level === "breach" ? "text-destructive" : "text-warning"}`}
                  >
                    <span className={`mt-1 size-1.5 rounded-full ${i.level === "breach" ? "bg-destructive" : "bg-warning"}`} />
                    <span className="flex-1">{i.msg}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-t border-border pt-2 text-xs text-success">
                All limits within legal range.
              </div>
            )}

            <DayHoursTable rows={rows} />
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  cap,
  unit,
  hint,
}: {
  label: string;
  value: number;
  cap: number;
  unit: string;
  hint?: string;
}) {
  const pct = Math.min(100, (value / cap) * 100);
  const color = pct >= 100 ? "bg-destructive" : pct >= 85 ? "bg-warning" : "bg-success";
  return (
    <div className="space-y-1" title={hint}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[11px]">
          {value.toFixed(1)}
          <span className="text-muted-foreground">/{cap}{unit}</span>
        </span>
      </div>
      <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function fmtHm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function DayHoursTable({ rows }: { rows: DriverDayHours[] }) {
  if (!rows.length) {
    return (
      <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
        No hours recorded yet.
      </div>
    );
  }
  const last14 = rows.slice(0, 14);
  return (
    <div className="border-t border-border pt-2 space-y-1">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        Last 14 days
      </div>
      <div className="max-h-44 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left py-1 font-normal">Date</th>
              <th className="text-right py-1 font-normal">On shift</th>
              <th className="text-right py-1 font-normal">Drive</th>
              <th className="text-right py-1 font-normal">Off</th>
            </tr>
          </thead>
          <tbody>
            {last14.map((r) => {
              const label = formatLedgerDay(r.day);
              return (
                <tr key={r.day} className="border-t border-border/40">
                  <td className="py-1">{label}</td>
                  <td className="py-1 text-right font-mono">{fmtHm(r.shift_minutes)}</td>
                  <td className="py-1 text-right font-mono">{fmtHm(r.drive_minutes)}</td>
                  <td className="py-1 text-right font-mono text-muted-foreground">
                    {fmtHm(r.off_minutes)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
