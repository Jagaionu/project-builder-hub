import { memo, useMemo, useState } from "react";
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
  Clock,
  User as UserIcon,
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

/* ─────────────────────────── small primitives ─────────────────────────── */

function SectionCard({
  title,
  icon,
  children,
  action,
  className = "",
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        "rounded-2xl border border-border/60 bg-surface/60 backdrop-blur-sm shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_1px_2px_rgba(0,0,0,0.04)] " +
        className
      }
    >
      <header className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          {icon}
          {title}
        </div>
        {action}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  icon,
  label,
  tone = "neutral",
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  tone?: "neutral" | "amber" | "emerald" | "red";
}) {
  const tones: Record<string, string> = {
    neutral:
      "border-border bg-surface text-foreground hover:bg-surface-2",
    amber:
      "border-amber-500/25 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15",
    emerald:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15",
    red: "border-red-500/25 bg-red-500/10 text-red-600 hover:bg-red-500/15",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold border shadow-sm transition-all active:scale-[0.97] disabled:opacity-50 " +
        tones[tone]
      }
    >
      {icon}
      {label}
    </button>
  );
}

function CopyChip({
  active,
  onClick,
  label = "Copy",
}: {
  active: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold border transition-colors " +
        (active
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
          : "border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-2")
      }
    >
      {active ? (
        <>
          <CheckCircle2 className="size-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3" /> {label}
        </>
      )}
    </button>
  );
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

/* ───────────────────────────── main panel ─────────────────────────────── */

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
  const paired = !!(driver as { user_id?: string | null }).user_id;
  const initials = useMemo(() => initialsOf(driver.name), [driver.name]);

  // ── Suspension ────────────────────────────────────────────────────────
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
    } else return null;
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
    <div className="h-full overflow-y-auto">
      {/* ─────────── Hero header ─────────── */}
      <div className="relative border-b border-border/60 bg-gradient-to-b from-surface/80 to-transparent px-6 pt-6 pb-5">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="relative shrink-0">
            <div className="size-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-border/60 flex items-center justify-center text-base font-semibold text-foreground tracking-wide">
              {initials || <UserIcon className="size-6 text-muted-foreground" />}
            </div>
            {isSuspended && (
              <span className="absolute -bottom-1 -right-1 size-5 rounded-full bg-amber-500 text-white flex items-center justify-center ring-2 ring-background">
                <Ban className="size-3" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold tracking-tight truncate">
              {driver.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                  <Clock className="size-3" />
                  {new Date(driver.last_update_time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              )}
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 shrink-0">
            <ToolbarButton
              onClick={() => onEdit(driver)}
              icon={<Pencil className="size-4" />}
              label="Edit"
            />
            {isSuspended ? (
              <ToolbarButton
                onClick={liftSuspend}
                disabled={busy}
                icon={<ShieldCheck className="size-4" />}
                label="Reinstate"
                tone="emerald"
              />
            ) : (
              <ToolbarButton
                onClick={() => setSuspendOpen((o) => !o)}
                disabled={busy}
                icon={<Ban className="size-4" />}
                label="Suspend"
                tone="amber"
              />
            )}
            <ToolbarButton
              onClick={() => onDelete(driver.id, driver.name)}
              icon={<Trash2 className="size-4" />}
              label="Delete"
              tone="red"
            />
          </div>
        </div>

        {/* Inline suspension form */}
        {suspendOpen && !isSuspended && (
          <div className="mt-5 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-amber-600 flex items-center gap-1.5">
                <Ban className="size-3.5" />
                Suspend {driver.name}
              </div>
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
                    "px-3 h-8 rounded-lg border text-xs font-medium transition-colors " +
                    (period === val
                      ? "border-amber-500 bg-amber-500/15 text-amber-700 shadow-sm"
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
                  className="h-8 rounded-lg border border-border bg-surface px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              )}
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional) — shown to the driver"
              className="w-full h-9 rounded-lg border border-border bg-surface px-3 text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <div className="flex gap-2">
              <button
                onClick={applySuspend}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 shadow-sm"
              >
                <Ban className="size-3.5" />
                {busy ? "Suspending…" : "Confirm suspension"}
              </button>
              <button
                onClick={() => setSuspendOpen(false)}
                className="px-3 h-9 rounded-lg border border-border bg-surface hover:bg-surface-2 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─────────── Body grid ─────────── */}
      <div className="p-6 grid grid-cols-12 gap-6 items-start">
        {/* Left column */}
        <div className="col-span-7 space-y-5">
          <SectionCard title="Contact" icon={<Phone className="size-3" />}>
            {/* Phone */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Phone number
                </label>
                {driver.phone && (
                  <CopyChip
                    active={copiedField === "Phone"}
                    onClick={() => copyToClipboard(driver.phone!, "Phone")}
                  />
                )}
              </div>
              <div className="px-3 h-10 flex items-center rounded-lg bg-background border border-border text-sm">
                {driver.phone ? (
                  <span className="font-mono text-foreground tracking-wide">
                    {driver.phone}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">Not provided</span>
                )}
              </div>
            </div>

            {/* App Code */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                  <Code2 className="size-3.5" /> App code
                </label>
                <div className="flex items-center gap-1">
                  {code && (
                    <>
                      <CopyChip
                        active={copiedField === "App Code"}
                        onClick={() => copyToClipboard(code, "App Code")}
                      />
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
              <div className="px-3 h-10 flex items-center justify-between gap-2 rounded-lg bg-background border border-border">
                <span className="font-mono text-sm tracking-[0.2em] text-foreground">
                  {code ?? "—"}
                </span>
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
          </SectionCard>

          {driver.current_lat != null && driver.current_lon != null && (
            <SectionCard title="Current location" icon={<MapPin className="size-3" />}>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-background border border-border px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                    Latitude
                  </div>
                  <div className="font-mono text-sm text-foreground">
                    {driver.current_lat.toFixed(6)}
                  </div>
                </div>
                <div className="rounded-lg bg-background border border-border px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                    Longitude
                  </div>
                  <div className="font-mono text-sm text-foreground">
                    {driver.current_lon.toFixed(6)}
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          <DriverItineraryTimeline driver={driver} jobs={activeJobs} />
        </div>

        {/* Right column */}
        <div className="col-span-5 space-y-5">
          <DriverHoursStatus driver={driver} compliance={compliance ?? null} />

          <SectionCard title="Schedule" icon={<CalendarDays className="size-3" />}>
            <ShiftCalendar driverId={driver.id} isPlanner={true} showPatternEditor={false} />
          </SectionCard>
        </div>
      </div>
    </div>
  );
});
