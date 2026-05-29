import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useDriverStore } from "@/lib/driver-store";
import { DriverJobCard } from "@/components/driver/DriverJobCard";
import { MapPin, Wifi, WifiOff, ChevronRight, History, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/d/")({
  head: () => ({ meta: [{ title: "Home — Driver" }] }),
  component: DriverHome,
});

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  ON_SHIFT: "On Shift",
  ON_ROUTE: "On Route",
  OFF_SHIFT: "Off Shift",
  DELAYED: "Delayed",
};
const STATUS_DOT: Record<string, string> = {
  AVAILABLE: "oklch(0.73 0.17 150)",
  ON_SHIFT: "oklch(0.62 0.22 245)",
  ON_ROUTE: "oklch(0.73 0.17 150)",
  OFF_SHIFT: "oklch(0.45 0.012 245)",
  DELAYED: "oklch(0.80 0.18 72)",
};

function DriverHome() {
  const driver = useDriverStore((s) => s.driver);
  const jobs = useDriverStore((s) => s.jobs);
  const isOnline = useDriverStore((s) => s.isOnline);
  const gps = useDriverStore((s) => s.gpsPosition);
  const [showCompleted, setShowCompleted] = useState(false);

  if (!driver) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Loading driver…</p>
        </div>
      </div>
    );
  }

  const isOnShift = driver.status !== "OFF_SHIFT";

  // Job Filtering
  const activeJobs = jobs.filter((j) => !["COMPLETED", "CANCELLED"].includes(j.status));
  const completedJobs = jobs.filter((j) => j.status === "COMPLETED");

  const dotColor = STATUS_DOT[driver.status] ?? "oklch(0.45 0.012 245)";

  return (
    <div
      className="pt-safe min-h-screen page-enter"
      style={{ paddingTop: "env(safe-area-inset-top, 0)" }}
    >
      {/* ── Header ── */}
      <div
        className="px-5 pt-6 pb-5"
        style={{
          background: "linear-gradient(180deg, oklch(0.17 0.018 245) 0%, transparent 100%)",
        }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Welcome back
            </p>
            <h1 className="text-2xl font-bold mt-0.5 tracking-tight">{driver.name}</h1>
          </div>
          {/* Status chip */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
            style={{
              background: "oklch(0.17 0.018 245)",
              border: "1px solid oklch(0.24 0.018 245)",
            }}
          >
            <span
              className="size-2 rounded-full shrink-0"
              style={{
                background: dotColor,
                boxShadow: `0 0 6px ${dotColor}`,
                animation: isOnShift ? "pulse 2s ease infinite" : "none",
              }}
            />
            <span className="text-xs font-semibold" style={{ color: dotColor }}>
              {STATUS_LABEL[driver.status]}
            </span>
          </div>
        </div>

        {/* Connectivity */}
        <div className="flex items-center gap-1.5 mt-3 text-[11px] text-muted-foreground">
          {isOnline ? (
            <Wifi className="size-3 text-success" />
          ) : (
            <WifiOff className="size-3 text-destructive" />
          )}
          <span>{isOnline ? "Connected" : "Offline"}</span>
          <span className="mx-1 opacity-30">·</span>
          <MapPin
            className="size-3"
            style={{ color: gps ? "oklch(0.73 0.17 150)" : "oklch(0.45 0.012 245)" }}
          />
          <span style={{ color: gps ? "oklch(0.73 0.17 150)" : undefined }}>
            {gps ? `GPS live · ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}` : "No GPS"}
          </span>
        </div>
      </div>

      <div className="px-4 space-y-6 pb-8">
        {/* ── Active Routes ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <PlayCircle className="size-4 text-primary" />
            <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Active Routes ({activeJobs.length})
            </h2>
          </div>

          {activeJobs.length === 0 ? (
            <div
              className="rounded-2xl p-6 text-center"
              style={{
                background: "oklch(0.17 0.018 245)",
                border: "1px solid oklch(0.24 0.018 245)",
              }}
            >
              <div className="text-2xl mb-2">✅</div>
              <p className="text-sm font-medium text-foreground">No active routes</p>
              <p className="text-xs text-muted-foreground mt-1">Check back with dispatch</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeJobs.map((j) => (
                <DriverJobCard key={j.id} job={j} />
              ))}
            </div>
          )}
        </section>

        {/* ── Completed Routes ── */}
        {completedJobs.length > 0 && (
          <section>
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="flex items-center justify-between w-full mb-3 group"
            >
              <div className="flex items-center gap-2">
                <History className="size-4 text-muted-foreground" />
                <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                  Completed ({completedJobs.length})
                </h2>
              </div>
              <ChevronRight
                className={`size-4 text-muted-foreground transition-transform ${showCompleted ? "rotate-90" : ""}`}
              />
            </button>

            {showCompleted && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                {completedJobs.map((j) => (
                  <DriverJobCard key={j.id} job={j} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
