import { memo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Copy,
  Share2,
  Phone,
  Code2,
  CheckCircle2,
  Pencil,
  Trash2,
  RefreshCw,
  CalendarDays,
  Ban,
  ShieldCheck,
  Hourglass,
} from "lucide-react";
import { toast } from "sonner";
import { setDriverSuspension } from "@/lib/driver-suspension.functions";
import { StatusBadge } from "@/components/StatusBadge";
import type { Driver } from "@/lib/types";
import { effectiveDriverStatus, type ScheduleStatus } from "@/lib/effective-status";
import type { ActiveJob } from "@/lib/use-driver-routes";
import type { Compliance } from "@/lib/compliance";
import { ShiftCalendar } from "@/components/driver/ShiftCalendar";
import { DriverItineraryTimeline } from "@/components/drivers/DriverItineraryTimeline";
import { DriverHoursStatus } from "@/components/drivers/DriverHoursStatus";

export const DriverDetailPanel = memo(function DriverDetailPanel({
  driver,
  activeJobs,
  schedule = "unknown",
  compliance,
  onEdit,
  onDelete,
  onRegenerate,
  onChanged,
}: {
  driver: Driver;
  activeJobs: ActiveJob[];
  schedule?: ScheduleStatus;
  compliance?: Compliance | null;
  onEdit: (driver: Driver) => void;
  onDelete: (driverId: string, driverName: string) => void;
  onRegenerate?: (driverId: string, driverName: string) => void;
  onChanged?: () => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const nowMs = Date.now();
  const effectiveStatus = effectiveDriverStatus(driver.status, activeJobs, nowMs, schedule);
  const code = (driver as { login_code?: string | null }).login_code ?? null;
  // A driver gets a user_id the first time they sign in with their code.
  const paired = !!(driver as { user_id?: string | null }).user_id;

  // ── Suspension ────────────────────────────────────────────────────────────
  const susp = driver as {
    suspended?: boolean | null;
    suspended_until?: string | null;
    suspended_reason?: string | null;
  };
  const isSuspended =
    !!susp.suspended &&
    (!susp.suspended_until || new Date(susp.suspended_until).getTime() > nowMs);
  const setSuspension = useServerFn(setDriverSuspension);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [period, setPeriod] = useState<"1d" | "1w" | "1m" | "custom" | "indefinite">("1w");
  const [customDate, setCustomDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const computeUntil = (): string | null => {
    const d = new Date();
    if (period === "1d") d.setDate(d.getDate() + 1);
    else if (period === "1w") d.setDate(d.getDate() + 7);
    else if (period === "1m") d.setMonth(d.getMonth() + 1);
    else if (period === "custom") {
      if (!customDate) return null;
      return new Date(customDate + "T23:59:59").toISOString();
    } else return null; // indefinite
    return d.toISOString();
  };

  const applySuspend = async () => {
    if (period === "custom" && !customDate) {
      toast.error("Pick a date for the suspension period");
      return;
    }
    setBusy(true);
    try {
      await setSuspension({
        data: {
          driverId: driver.id,
          suspended: true,
          until: computeUntil(),
          reason: reason.trim() || null,
        },
      });
      toast.success(`${driver.name} suspended`);
      setSuspendOpen(false);
      setReason("");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to suspend");
    } finally {
      setBusy(false);
    }
  };

  const liftSuspend = async () => {
    setBusy(true);
    try {
      await setSuspension({ data: { driverId: driver.id, suspended: false } });
      toast.success(`${driver.name} reinstated`);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reinstate");
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(`${field} copied to clipboard`);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const shareAppCode = async () => {
    if (!code) {
      toast.error("No app code yet");
      return;
    }
    const driverLoginUrl = `${window.location.origin}/d/login`;
    const msg = `Hi ${driver.name}, your driver app:\n${driverLoginUrl}\nCode: ${code}`;
    try {
      await navigator.clipboard.writeText(msg);
      toast.success("Share message copied — paste into WhatsApp/SMS");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{driver.name}</h2>
          <div className="mt-2 flex items-center gap-3">
            <StatusBadge status={effectiveStatus} kind="driver" />
            {isSuspended && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
                <Ban className="size-3" />
                Suspended
                {susp.suspended_until
                  ? ` until ${new Date(susp.suspended_until).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}`
                  : ""}
              </span>
            )}
            {driver.last_update_time && (
              <span className="text-xs text-muted-foreground font-mono">
                Last update:{" "}
                {new Date(driver.last_update_time).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(driver)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-border bg-surface text-foreground shadow-sm hover:bg-surface-2 active:scale-[0.97] transition-all"
          >
            <Pencil className="size-4" /> Edit
          </button>
          {isSuspended ? (
            <button
              onClick={liftSuspend}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 shadow-sm hover:bg-emerald-500/20 active:scale-[0.97] transition-all disabled:opacity-50"
            >
              <ShieldCheck className="size-4" /> Reinstate
            </button>
          ) : (
            <button
              onClick={() => setSuspendOpen((o) => !o)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-amber-500/20 bg-amber-500/10 text-amber-600 shadow-sm hover:bg-amber-500/20 active:scale-[0.97] transition-all disabled:opacity-50"
            >
              <Ban className="size-4" /> Suspend
            </button>
          )}
          <button
            onClick={() => onDelete(driver.id, driver.name)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-red-500/20 bg-red-500/10 text-red-600 shadow-sm hover:bg-red-500/20 active:scale-[0.97] transition-all"
          >
            <Trash2 className="size-4" /> Delete
          </button>
        </div>
      </div>

      {suspendOpen && !isSuspended && (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-3">
            Suspend {driver.name}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {(
              [
                ["1d", "1 day"],
                ["1w", "1 week"],
                ["1m", "1 month"],
                ["custom", "Until date"],
                ["indefinite", "Indefinite"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setPeriod(val)}
                className={
                  "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors " +
                  (period === val
                    ? "border-amber-500 bg-amber-500/15 text-amber-700"
                    : "border-border bg-surface hover:bg-surface-2 text-foreground")
                }
              >
                {label}
              </button>
            ))}
            {period === "custom" && (
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
              />
            )}
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional) — shown to the driver"
            className="w-full h-9 rounded-md border border-border bg-surface px-3 text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-2">
            <button
              onClick={applySuspend}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50"
            >
              <Ban className="size-3.5" /> {busy ? "Suspending…" : "Confirm suspension"}
            </button>
            <button
              onClick={() => setSuspendOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Left Side: Info */}
        <div className="col-span-7 space-y-6">
          {/* Contact Information */}
          <div className="rounded-2xl border border-border/60 bg-surface/60 p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-4">
              Contact Information
            </div>

            {/* Phone */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Phone className="size-3.5" /> Phone
                </label>
                {driver.phone && (
                  <button
                    onClick={() => copyToClipboard(driver.phone!, "Phone")}
                    className={
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold border transition-colors " +
                      (copiedField === "Phone"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                        : "border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-2")
                    }
                  >
                    {copiedField === "Phone" ? (
                      <>
                        <CheckCircle2 className="size-3" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" /> Copy
                      </>
                    )}
                  </button>
                )}
              </div>
              <div className="px-3 py-2 rounded-lg bg-background border border-border text-sm">
                {driver.phone ? (
                  <span className="font-mono text-foreground">{driver.phone}</span>
                ) : (
                  <span className="text-muted-foreground italic">Not provided</span>
                )}
              </div>
            </div>

            {/* App Code */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Code2 className="size-3.5" /> App Code
                </label>
                <div className="flex items-center gap-1">
                  {code && (
                    <>
                      <button
                        onClick={() => copyToClipboard(code, "App Code")}
                        className={
                          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold border transition-colors " +
                          (copiedField === "App Code"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                            : "border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-2")
                        }
                      >
                        {copiedField === "App Code" ? (
                          <>
                            <CheckCircle2 className="size-3" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" /> Copy
                          </>
                        )}
                      </button>
                      <button
                        onClick={shareAppCode}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold border border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                      >
                        <Share2 className="size-3" /> Share
                      </button>
                    </>
                  )}
                  {onRegenerate && (
                    <button
                      onClick={() => onRegenerate(driver.id, driver.name)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold border border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                    >
                      <RefreshCw className="size-3" /> Regen
                    </button>
                  )}
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-background border border-border font-mono text-sm text-foreground flex items-center justify-between gap-2">
                <span>{code ?? "—"}</span>
                {code &&
                  (paired ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-sans font-semibold text-emerald-600 bg-emerald-500/10 border border-emerald-500/30"
                      title="Driver has signed in with this code"
                    >
                      <CheckCircle2 className="size-3" /> Paired
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-sans font-semibold text-amber-600 bg-amber-500/10 border border-amber-500/30"
                      title="Code issued — waiting for the driver to sign in"
                    >
                      <Hourglass className="size-3" /> Pending
                    </span>
                  ))}
              </div>
            </div>
          </div>

          {/* Location Information */}
          {driver.current_lat != null && driver.current_lon != null && (
            <div className="rounded-2xl border border-border/60 bg-surface/60 p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
                Current Location
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">Latitude</div>
                  <div className="font-mono text-sm text-foreground">
                    {driver.current_lat.toFixed(6)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">Longitude</div>
                  <div className="font-mono text-sm text-foreground">
                    {driver.current_lon.toFixed(6)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <DriverItineraryTimeline driver={driver} jobs={activeJobs} />
        </div>

        {/* Right Side: Hours + Schedule */}
        <div className="col-span-5 space-y-4">
          {/* Hours Status Dashboard */}
          <DriverHoursStatus driver={driver} compliance={compliance ?? null} />

          {/* Driver Schedule (calendar only — base warehouse + weekly pattern live in Edit dialog) */}
          <div className="rounded-2xl border border-border/60 bg-surface/60 p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-2">
              <CalendarDays className="size-3.5" />
              Schedule
            </div>
            <ShiftCalendar driverId={driver.id} isPlanner={true} showPatternEditor={false} />
          </div>
        </div>
      </div>
    </div>
  );
});
