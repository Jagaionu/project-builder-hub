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
  MapPin,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { setDriverSuspension } from "@/lib/driver-suspension.functions";
import { reviewDriverAvatar } from "@/lib/driver-avatar.functions";
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

  // ── Profile photo ───────────────────────────────────────────────────────
  const av = driver as {
    avatar_url?: string | null;
    pending_avatar_url?: string | null;
    avatar_status?: string | null;
  };
  const approvedAvatar = av.avatar_status === "approved" ? (av.avatar_url ?? null) : null;
  const pendingAvatar = av.avatar_status === "pending" ? (av.pending_avatar_url ?? null) : null;
  const reviewAvatar = useServerFn(reviewDriverAvatar);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const reviewPhoto = async (approve: boolean) => {
    setAvatarBusy(true);
    try {
      await reviewAvatar({ data: { driverId: driver.id, approve } });
      toast.success(approve ? "Photo approved" : "Photo rejected");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed");
    } finally {
      setAvatarBusy(false);
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

  // Shared style for the two copy buttons — "copied" state uses a neutral
  // confirmation color so emerald stays reserved for Paired / Reinstated.
  const copyBtnClass = (field: string) =>
    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold border transition-colors " +
    (copiedField === field
      ? "border-foreground/30 bg-foreground/5 text-foreground"
      : "border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-2");

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {approvedAvatar && (
            <img
              src={approvedAvatar}
              alt=""
              className="size-12 rounded-full object-cover border border-border shrink-0"
            />
          )}
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight truncate">{driver.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
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
          </div>
          {driver.last_update_time && (
            <div className="mt-1.5 text-[11px] text-muted-foreground/70 font-mono">
              Last update{" "}
              {new Date(driver.last_update_time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
          )}
          </div>
        </div>

        <div className="flex items-start gap-2 shrink-0">
          <button
            onClick={() => onEdit(driver)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-border bg-surface text-foreground shadow-sm hover:bg-surface-2 active:scale-[0.97] transition-all"
          >
            <Pencil className="size-4" /> Edit
          </button>

          {/* Suspend / Reinstate — panel is anchored to this button, not the page */}
          <div className="relative">
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

            {suspendOpen && !isSuspended && (
              <div className="absolute right-0 top-full z-20 mt-2 w-[22rem] rounded-xl border border-amber-500/40 bg-surface p-4 shadow-lg">
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
                </div>
                {period === "custom" && (
                  <div className="mb-3">
                    <label className="block text-[10px] text-muted-foreground mb-1">Until</label>
                    <input
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                    />
                  </div>
                )}
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (optional) — shown to the driver"
                  className="w-full h-9 rounded-md border border-border bg-surface px-3 text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {period === "indefinite" && (
                  <div className="mb-3 text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded-md px-2.5 py-1.5">
                    Indefinite suspension stays active until manually reinstated.
                  </div>
                )}
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
          </div>

          <button
            onClick={() => onDelete(driver.id, driver.name)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-red-500/20 bg-red-500/10 text-red-600 shadow-sm hover:bg-red-500/20 active:scale-[0.97] transition-all"
          >
            <Trash2 className="size-4" /> Delete
          </button>
        </div>
      </div>

      {pendingAvatar && (
        <div className="mb-6 flex items-center gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <img
            src={pendingAvatar}
            alt=""
            className="size-16 rounded-full object-cover border border-border shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-1">
              Profile photo — pending review
            </div>
            <p className="text-xs text-muted-foreground">
              {driver.name} submitted a profile photo. Approve it to show across the app, or reject
              it if it doesn't follow the rules.
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => reviewPhoto(true)}
              disabled={avatarBusy}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              <Check className="size-3.5" /> Approve
            </button>
            <button
              onClick={() => reviewPhoto(false)}
              disabled={avatarBusy}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/20 bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <X className="size-3.5" /> Reject
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Left Side: Info */}
        <div className="col-span-7 space-y-6">
          {/* Contact Information — primary card: solid border/bg */}
          <div className="rounded-2xl border border-border bg-surface p-4">
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
                  <button onClick={() => copyToClipboard(driver.phone!, "Phone")} className={copyBtnClass("Phone")}>
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
                  <span className="font-mono font-medium text-foreground">{driver.phone}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
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
                      <button onClick={() => copyToClipboard(code, "App Code")} className={copyBtnClass("App Code")}>
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
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold border border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                    >
                      <RefreshCw className="size-3" /> Regen
                    </button>
                  )}
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-background border border-border font-mono text-sm text-foreground flex items-center justify-between gap-2">
                <span className="font-medium">{code ?? "—"}</span>
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

            {/* Location — collapsed to one line, not its own card */}
            {driver.current_lat != null && driver.current_lon != null && (
              <div className="mt-4 pt-4 border-t border-border/60">
                <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2 mb-2">
                  <MapPin className="size-3.5" /> Location
                </label>
                <div className="px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono text-foreground">
                  {driver.current_lat.toFixed(5)}, {driver.current_lon.toFixed(5)}
                </div>
              </div>
            )}
          </div>

          <DriverItineraryTimeline driver={driver} jobs={activeJobs} />
        </div>

        {/* Right Side: Hours + Schedule */}
        <div className="col-span-5 space-y-4">
          {/* Hours Status Dashboard */}
          <DriverHoursStatus driver={driver} compliance={compliance ?? null} />

          {/* Driver Schedule — secondary surface, recedes behind Hours Status */}
          <div className="rounded-2xl border border-border/40 bg-surface/40 p-3">
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
