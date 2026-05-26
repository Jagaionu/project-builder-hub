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
import { getTenantId } from "@/lib/tenant-insert";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X, KeyRound, Copy, Link as LinkIcon } from "lucide-react";
import { rotateDriverLoginCode } from "@/lib/pairing.functions";
import { deleteDriver } from "@/lib/drivers-delete.functions";
import { useActiveJobsByDriver, type ActiveJob } from "@/lib/use-driver-routes";
import { effectiveDriverStatus, projectedRouteDriveMinutes, jobStartMs, isJobScheduledFuture } from "@/lib/effective-status";
import { DispatchStat } from "@/components/dispatch/toolbar";

type DriverRouteFilter = "ON_ROUTE" | "ON_SHIFT" | "OFF_SHIFT";
const ALL_DRIVER_ROUTE_FILTERS: DriverRouteFilter[] = ["ON_ROUTE", "ON_SHIFT", "OFF_SHIFT"];
type DriverListFilter = "ALL" | DriverRouteFilter;
const DRIVER_FILTER_STORAGE_KEY = "drivers.routeShiftFilters";
const DRIVER_SEARCH_STORAGE_KEY = "drivers.searchByName";

export const Route = createFileRoute("/_app/drivers")({
  loader: () => getDriversSnapshot(),
  component: DriversPage,
  head: () => ({ meta: [{ title: "Drivers — Planning System" }] }),
});

type DriverForm = { name: string; phone: string };

function formatStableTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss} UTC`;
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
  const activeJobsByDriver = useActiveJobsByDriver();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DriverForm>({ name: "", phone: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DriverForm>({ name: "", phone: "" });

  // ── Drivers list filters (persisted) ────────────────────────────────────
  const [driverListFilter, setDriverListFilter] = useState<DriverListFilter>(() => {
    if (typeof window === "undefined") return "ALL";
    try {
      const raw = localStorage.getItem(DRIVER_FILTER_STORAGE_KEY);
      if (!raw) return "ALL";
      const parsed = JSON.parse(raw) as unknown;

      if (typeof parsed === "string") {
        if (parsed === "ALL") return "ALL";
        if (ALL_DRIVER_ROUTE_FILTERS.includes(parsed as DriverRouteFilter)) return parsed as DriverRouteFilter;
        return "ALL";
      }

      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (v): v is DriverRouteFilter =>
            typeof v === "string" && ALL_DRIVER_ROUTE_FILTERS.includes(v as DriverRouteFilter),
        );
        if (valid.length === 3) return "ALL";
        if (valid.length === 1) return valid[0];
        return valid.includes("OFF_SHIFT")
          ? "OFF_SHIFT"
          : valid.includes("ON_SHIFT")
            ? "ON_SHIFT"
            : valid.includes("ON_ROUTE")
              ? "ON_ROUTE"
              : "ALL";
      }

      return "ALL";
    } catch {
      return "ALL";
    }
  });

  const [driverSearch, setDriverSearch] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(DRIVER_SEARCH_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DRIVER_FILTER_STORAGE_KEY, JSON.stringify(driverListFilter));
    } catch {
      /* noop */
    }
  }, [driverListFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(DRIVER_SEARCH_STORAGE_KEY, driverSearch);
    } catch {
      /* noop */
    }
  }, [driverSearch]);

  const nowMs = Date.now();
  const driverRows = drivers.map((d) => {
    const effectiveStatus = effectiveDriverStatus(d.status, activeJobsByDriver[d.id] ?? [], nowMs);
    const category: DriverRouteFilter =
      effectiveStatus === "ON_ROUTE"
        ? "ON_ROUTE"
        : effectiveStatus === "OFF_SHIFT"
          ? "OFF_SHIFT"
          : "ON_SHIFT";
    return { d, effectiveStatus, category };
  });

  const q = driverSearch.trim().toLowerCase();
  const driverRowsAfterSearch = driverRows.filter((r) => !q || r.d.name.toLowerCase().includes(q));

  const counts = driverRowsAfterSearch.reduce(
    (acc, r) => {
      acc[r.category] += 1;
      return acc;
    },
    { ON_ROUTE: 0, ON_SHIFT: 0, OFF_SHIFT: 0 } as Record<DriverRouteFilter, number>,
  );

  const filteredDriverRows = driverRowsAfterSearch.filter((r) => {
    if (driverListFilter === "ALL") return true;
    return r.category === driverListFilter;
  });

  const rotateCode = useServerFn(rotateDriverLoginCode);
  const removeDriver = useServerFn(deleteDriver);

  async function regenerate(driverId: string, driverName: string) {
    if (!confirm(`Regenerate login code for "${driverName}"?\n\nThe old code will stop working immediately. The driver will need the new code to log in.`)) return;
    try {
      // FIX: Pass driverId directly, not wrapped in { data: ... }
      const newCode = await rotateCode({ driverId });
      await navigator.clipboard?.writeText(newCode).catch(() => {});
      toast.success(`New code ${newCode} — copied to clipboard`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function add() {
    if (!form.name) return toast.error("Name required");
    const tenant_id = await getTenantId();
    const { data, error } = await supabase.from("drivers").insert({
      name: form.name,
      phone: form.phone || null,
      status: "OFF_SHIFT",
      tenant_id,
    }).select("id, login_code").single();
    if (error || !data) { toast.error(error?.message ?? "Failed to add driver"); return; }
    const code = (data as { login_code?: string | null }).login_code;
    if (code) {
      await navigator.clipboard?.writeText(code).catch(() => {});
      toast.success(`Driver added — code ${code} copied to clipboard`);
    } else {
      toast.success("Driver added");
    }
    setOpen(false);
    setForm({ name: "", phone: "" });
  }

  function startEdit(d: { id: string; name: string; phone: string | null }) {
    setEditingId(d.id);
    setEditForm({ name: d.name, phone: d.phone ?? "" });
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.name) return toast.error("Name required");
    const { error } = await supabase
      .from("drivers")
      .update({
        name: editForm.name,
        phone: editForm.phone || null,
      })
      .eq("id", editingId);
    if (error) toast.error(error.message);
    else {
      toast.success("Driver updated");
      setEditingId(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete driver "${name}"?\n\nThis removes the driver, their login, GPS history, events and shift records.`)) return;
    try {
      // FIX: Pass id directly, not wrapped in { data: ... }
      await (removeDriver as any)({ data: { driverId: id } });
      toast.success("Driver deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const driverLoginUrl = (typeof window !== "undefined" ? window.location.origin : "") + "/d/login";

  async function copyDriverLink() {
    await navigator.clipboard?.writeText(driverLoginUrl).catch(() => {});
    toast.success("Driver login link copied");
  }

  async function copyInvite(name: string, code: string | null) {
    if (!code) return toast.error("No code yet — click Generate");
    const msg = `Hi ${name}, your driver app:\n${driverLoginUrl}\nCode: ${code}`;
    await navigator.clipboard?.writeText(msg).catch(() => {});
    toast.success("Invite message copied — paste into WhatsApp/SMS");
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Drivers"
        subtitle={`${filteredDriverRows.length} shown of ${drivers.length} drivers in roster`}
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <DispatchStat
                label="All"
                value={driverRowsAfterSearch.length}
                color={"oklch(0.52 0.012 245)"}
                active={driverListFilter === "ALL"}
                onClick={() => setDriverListFilter("ALL")}
              />
              <DispatchStat
                label="On Route"
                value={counts.ON_ROUTE}
                color={"oklch(0.73 0.17 150)"}
                active={driverListFilter === "ON_ROUTE"}
                onClick={() => setDriverListFilter("ON_ROUTE")}
              />
              <DispatchStat
                label="On Shift"
                value={counts.ON_SHIFT}
                color={"oklch(0.62 0.22 245)"}
                active={driverListFilter === "ON_SHIFT"}
                onClick={() => setDriverListFilter("ON_SHIFT")}
              />
              <DispatchStat
                label="Off Shift"
                value={counts.OFF_SHIFT}
                color={"oklch(0.45 0.012 245)"}
                active={driverListFilter === "OFF_SHIFT"}
                onClick={() => setDriverListFilter("OFF_SHIFT")}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={copyDriverLink}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border bg-surface hover:bg-surface-2 text-xs font-medium"
                title={driverLoginUrl}
              >
                <LinkIcon className="size-3.5" /> Copy driver link
              </button>
              <button
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium"
              >
                <Plus className="size-3.5" /> New Driver
              </button>
            </div>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {open && (
          <div className="rounded-md border border-border bg-surface p-4 grid grid-cols-3 gap-3 items-end">
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <button onClick={add} className="h-9 px-3 rounded bg-primary text-primary-foreground text-sm">
              Create
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            value={driverSearch}
            onChange={(e) => setDriverSearch(e.target.value)}
            placeholder="Search driver name…"
            className="field-input"
            style={{ flex: 1 }}
          />
        </div>

        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">App Code</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Tomorrow</th>
                <th className="px-3 py-2 text-left">Compliance (UK HGV)</th>
                <th className="px-3 py-2 text-left">Last Update</th>
                <th className="px-3 py-2 text-right">Coords</th>
                <th className="px-3 py-2 text-right w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredDriverRows.map(({ d, effectiveStatus }) => {
                const isEditing = editingId === d.id;
                const code = (d as { login_code?: string | null }).login_code ?? null;
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
                    <td className="px-3 py-2.5">
                      {code ? (
                        <button
                          onClick={() => {
                            navigator.clipboard?.writeText(code);
                            toast.success(`${code} copied`);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary font-mono text-xs tracking-widest"
                          title="Click to copy"
                        >
                          {code}
                          <Copy className="size-2.5 opacity-60" />
                        </button>
                      ) : (
                        <button
                          onClick={() => regenerate(d.id, d.name)}
                          className="text-[11px] text-muted-foreground hover:text-primary underline"
                        >
                          Generate
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={effectiveStatus} kind="driver" />
                    </td>
                    <td className="px-3 py-2.5">
                      <TomorrowCell
                        available={(d as { available_tomorrow?: boolean }).available_tomorrow === true}
                        hasLocation={(d as { tomorrow_start_lat?: number | null }).tomorrow_start_lat != null}
                        updatedAt={(d as { tomorrow_start_updated_at?: string | null }).tomorrow_start_updated_at ?? null}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <ComplianceCell
                        c={compliance[d.id]}
                        rows={driverDayHours[d.id] ?? []}
                        activeJobs={activeJobsByDriver[d.id] ?? []}
                        driverLat={d.current_lat}
                        driverLon={d.current_lon}
                      />
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
                              onClick={() => regenerate(d.id, d.name)}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-warning text-[11px]"
                              title="Regenerate login code (asks for confirmation)"
                            >
                              <KeyRound className="size-3.5" /> Regen code
                            </button>
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
                            <button onClick={() => copyInvite(d.name, code)} title="Copy login link + code for this driver" className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-primary"><LinkIcon className="size-3.5" /></button>
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

function TomorrowCell({ available, hasLocation, updatedAt }: { available: boolean; hasLocation: boolean; updatedAt: string | null }) {
  if (!available) {
    return <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60"><span className="size-1.5 rounded-full bg-muted-foreground/40" />Not set</span>;
  }
  const tone = hasLocation ? "text-success" : "text-warning";
  const dot = hasLocation ? "bg-success" : "bg-warning";
  const label = hasLocation ? "Available" : "Needs location";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${tone}`} title={updatedAt ? `Updated ${new Date(updatedAt).toLocaleString()}` : undefined}>
      <span className={`size-1.5 rounded-full ${dot}`} /> {label}
    </span>
  );
}

function ComplianceCell({ c, rows, activeJobs, driverLat, driverLon }: { c: Compliance | undefined; rows: DriverDayHours[]; activeJobs: ActiveJob[]; driverLat: number | null; driverLon: number | null }) {
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
  const liveLabel = c.onShift ? (
    c.continuousDrive >= 4.5 ? (
      <span>break overdue</span>
    ) : (
      <>break in <LiveTimer baseHours={4.5 - c.continuousDrive} dir="down" /></>
    )
  ) : (
    <>rest <LiveTimer baseHours={Math.min(c.restHours, 99)} dir="up" /></>
  );
  const label = c.status === "breach" ? "Breach" : c.status === "warn" ? "Warning" : `${tightest.toFixed(1)}h left`;

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
        <span className="opacity-60 font-mono text-[10px] hidden sm:inline">· {liveLabel}</span>
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
              <Metric label="Today (24h)" value={c.daily} cap={10} unit="h" hint="Max 9h, 10h up to 2×/wk" live={c.onShift ? "up" : undefined} />
              <Metric label="This week" value={c.weekly} cap={56} unit="h" hint="56h rolling 7 days" live={c.onShift ? "up" : undefined} />
              <Metric label="Fortnight" value={c.twoWeek} cap={90} unit="h" hint="90h rolling 14 days" />
              {c.onShift ? (
                <Metric label="Drive cycle" value={c.continuousDrive} cap={4.5} unit="h" hint="45min break after 4.5h" live="up" />
              ) : (
                <Metric label="Rest taken" value={Math.min(c.restHours, 24)} cap={11} unit="h" hint="11h normal, 9h reduced" live="up" />
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

            <ProjectedRoutePanel jobs={activeJobs} driverLat={driverLat} driverLon={driverLon} dailyHeadroomH={c.dailyHeadroom} continuousDriveH={c.continuousDrive} onShift={c.onShift} />

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
  live,
}: {
  label: string;
  value: number;
  cap: number;
  unit: string;
  hint?: string;
  live?: "up" | "down";
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

function LiveTimer({ baseHours, dir }: { baseHours: number; dir: "up" | "down" }) {
  const anchorRef = useRef<{ base: number; at: number }>({ base: baseHours, at: Date.now() });
  const [, force] = useState(0);
  useEffect(() => {
    anchorRef.current = { base: baseHours, at: Date.now() };
    force((n) => n + 1);
  }, [baseHours]);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsedSec = (Date.now() - anchorRef.current.at) / 1000;
  let totalSec = anchorRef.current.base * 3600 + (dir === "up" ? elapsedSec : -elapsedSec);
  if (totalSec < 0) totalSec = 0;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return (
    <span className="tabular-nums">
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
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

function ProjectedRoutePanel({
  jobs,
  driverLat,
  driverLon,
  dailyHeadroomH,
  continuousDriveH,
  onShift,
}: {
  jobs: ActiveJob[];
  driverLat: number | null;
  driverLon: number | null;
  dailyHeadroomH: number;
  continuousDriveH: number;
  onShift: boolean;
}) {
  if (!jobs.length) return null;
  const now = Date.now();
  return (
    <div className="border-t border-border pt-2 space-y-1.5">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        Active routes (transit only)
      </div>
      {jobs.map((j) => {
        const proj = projectedRouteDriveMinutes(j, driverLat, driverLon);
        const startMs = jobStartMs(j);
        const future = isJobScheduledFuture(j, now);
        const startLabel = startMs
          ? new Date(startMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "—";
        // FIX: Correct break scheduling – mandatory immediate break if already at or over 4.5h
        let effectiveCycleStartH = onShift ? continuousDriveH : 0;
        let breaksNeeded = 0;
        let immediateBreak = false;
        if (effectiveCycleStartH >= 4.5) {
          immediateBreak = true;
          // After a 45min break, the cycle resets to 0.
          // Subtract one full 4.5 block from the accumulated driving time
          // to compute how many more breaks are needed during the route.
          const excess = effectiveCycleStartH - 4.5;
          effectiveCycleStartH = excess; // start new cycle with the excess over 4.5h
          breaksNeeded = 1;
        }
        const totalH = proj.totalMin / 60;
        const additionalBreaks = Math.max(
          0,
          Math.floor((effectiveCycleStartH + totalH) / 4.5) - Math.floor(effectiveCycleStartH / 4.5)
        );
        breaksNeeded += additionalBreaks;
        const breakMin = breaksNeeded * 45;
        const totalWithBreaksMin = proj.totalMin + breakMin;
        const wouldExceed = totalWithBreaksMin / 60 > dailyHeadroomH;
        const chain = [...(j.stops ?? [])]
          .sort((a, b) => a.seq - b.seq)
          .map((s) => s.warehouse?.code ?? "?")
          .join(" → ");
        return (
          <div
            key={j.id}
            className={`rounded border px-2 py-1.5 text-[11px] ${wouldExceed ? "border-destructive/40 bg-destructive/5" : "border-border bg-surface-2/40"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-muted-foreground truncate">{chain || j.id.slice(0, 6)}</span>
              <span className={`font-mono ${future ? "text-info" : "text-foreground"}`}>
                {future ? "scheduled" : j.status.replace(/_/g, " ").toLowerCase()} · {startLabel}
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 font-mono">
              <span className="text-muted-foreground">
                deadhead {fmtHm(proj.deadheadMin)} · transit {fmtHm(proj.transitMin)}
              </span>
              <span className={wouldExceed ? "text-destructive font-semibold" : ""}>
                {fmtHm(totalWithBreaksMin)} total
              </span>
            </div>
            {breaksNeeded > 0 && startMs && (() => {
              const fmtClock = (ms: number) =>
                new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const breaks: { startMs: number; endMs: number }[] = [];
              let remainingBreaks = breaksNeeded;
              let cursor = startMs;
              let cycleStart = immediateBreak ? 0 : (onShift ? continuousDriveH : 0);
              if (immediateBreak) {
                // First break starts immediately
                const bStart = cursor;
                const bEnd = bStart + 45 * 60_000;
                breaks.push({ startMs: bStart, endMs: bEnd });
                cursor = bEnd;
                cycleStart = 0;
                remainingBreaks--;
              }
              let driven = cycleStart;
              while (remainingBreaks > 0) {
                const toNextBreakH = 4.5 - driven;
                const bStart = cursor + toNextBreakH * 3_600_000;
                const bEnd = bStart + 45 * 60_000;
                breaks.push({ startMs: bStart, endMs: bEnd });
                cursor = bEnd;
                driven = 0;
                remainingBreaks--;
              }
              const routeEndMs = startMs + totalWithBreaksMin * 60_000;
              return (
                <div className="mt-1 space-y-0.5 text-[10px] text-warning">
                  {breaks.map((b, i) => (
                    <div key={i}>
                      Break {i + 1}: {fmtClock(b.startMs)} → {fmtClock(b.endMs)} (45 min)
                    </div>
                  ))}
                  <div className="text-muted-foreground">
                    Route finishes ~{fmtClock(routeEndMs)} (without breaks {fmtClock(startMs + proj.totalMin * 60_000)})
                  </div>
                </div>
              );
            })()}
            {breaksNeeded === 0 && startMs && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                Route finishes ~{new Date(startMs + proj.totalMin * 60_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · no break required
              </div>
            )}
            {wouldExceed && (
              <div className="mt-0.5 text-[10px] text-destructive">
                Exceeds remaining daily headroom ({dailyHeadroomH.toFixed(1)}h left)
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
