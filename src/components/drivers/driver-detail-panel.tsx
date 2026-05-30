import { memo, useState } from "react";
import { Copy, Share2, Phone, Code2, CheckCircle2, Pencil, Trash2, RefreshCw, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import type { Driver } from "@/lib/types";
import { effectiveDriverStatus } from "@/lib/effective-status";
import type { ActiveJob } from "@/lib/use-driver-routes";
import { ShiftCalendar } from "@/components/driver/ShiftCalendar";

export const DriverDetailPanel = memo(function DriverDetailPanel({
  driver,
  activeJobs,
  onEdit,
  onDelete,
  onRegenerate,
}: {
  driver: Driver;
  activeJobs: ActiveJob[];
  onEdit: (driver: Driver) => void;
  onDelete: (driverId: string, driverName: string) => void;
  onRegenerate?: (driverId: string, driverName: string) => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const nowMs = Date.now();
  const effectiveStatus = effectiveDriverStatus(driver.status, activeJobs, nowMs);
  const code = (driver as { login_code?: string | null }).login_code ?? null;

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
            {driver.last_update_time && (
              <span className="text-xs text-muted-foreground font-mono">
                Last update: {new Date(driver.last_update_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(driver)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface hover:bg-surface-2 text-xs font-medium"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
          <button
            onClick={() => onDelete(driver.id, driver.name)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-xs font-medium text-red-600"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Left Side: Info */}
        <div className="col-span-7 space-y-6">
          {/* Contact Information */}
          <div className="rounded-lg border border-border bg-surface p-4">
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
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors"
                    style={{
                      background: copiedField === "Phone" ? "oklch(0.73 0.17 150 / 0.15)" : "oklch(0.62 0.22 245 / 0.08)",
                      color: copiedField === "Phone" ? "var(--success-fg)" : "var(--primary-bright)",
                    }}
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
              <div className="px-3 py-2 rounded bg-[oklch(0.17_0.018_245)] border border-[oklch(0.26_0.018_245)] font-mono text-sm text-foreground">
                {driver.phone ?? "—"}
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
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors"
                        style={{
                          background: copiedField === "App Code" ? "oklch(0.73 0.17 150 / 0.15)" : "oklch(0.62 0.22 245 / 0.08)",
                          color: copiedField === "App Code" ? "var(--success-fg)" : "var(--primary-bright)",
                        }}
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
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
                      >
                        <Share2 className="size-3" /> Share
                      </button>
                    </>
                  )}
                  {onRegenerate && (
                    <button
                      onClick={() => onRegenerate(driver.id, driver.name)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                    >
                      <RefreshCw className="size-3" /> Regen
                    </button>
                  )}
                </div>
              </div>
              <div className="px-3 py-2 rounded bg-[oklch(0.17_0.018_245)] border border-[oklch(0.26_0.018_245)] font-mono text-sm text-foreground">
                {code ?? "—"}
              </div>
            </div>
          </div>

          {/* Location Information */}
          {driver.current_lat != null && driver.current_lon != null && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
                Current Location
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">Latitude</div>
                  <div className="font-mono text-sm text-foreground">{driver.current_lat.toFixed(6)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">Longitude</div>
                  <div className="font-mono text-sm text-foreground">{driver.current_lon.toFixed(6)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Schedule */}
        <div className="col-span-5">
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
              <CalendarDays className="size-3.5" />
              Driver Schedule
            </div>
            <ShiftCalendar driverId={driver.id} isPlanner={true} />
          </div>
        </div>
      </div>
    </div>
  );
});
