import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useDriverStore } from "@/lib/driver-store";
import { supabase } from "@/integrations/supabase/client";
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
  AVAILABLE: "var(--success)",
  ON_SHIFT: "var(--primary)",
  ON_ROUTE: "var(--success)",
  OFF_SHIFT: "var(--muted-foreground-2)",
  DELAYED: "var(--warning)",
};

function DriverHome() {
  const driver = useDriverStore((s) => s.driver);
  const jobs = useDriverStore((s) => s.jobs);
  const isOnline = useDriverStore((s) => s.isOnline);
  const gps = useDriverStore((s) => s.gpsPosition);
  const gpsError = useDriverStore((s) => s.gpsError);
  const [showCompleted, setShowCompleted] = useState(false);
  const [equip, setEquip] = useState<string[]>([]);
  useEffect(() => {
    if (!driver) return;
    let cancelled = false;
    void (async () => {
      const { data } = await (supabase as unknown as { from: (t: string) => any })
        .from("driver_equipment")
        .select("equipment_type")
        .eq("driver_id", driver.id);
      if (!cancelled)
        setEquip(((data ?? []) as Array<{ equipment_type: string }>).map((r) => r.equipment_type));
    })();
    return () => {
      cancelled = true;
    };
  }, [driver]);

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

  // Job Filtering
  const activeJobs = jobs.filter((j) => !["COMPLETED", "CANCELLED"].includes(j.status));
  const completedJobs = jobs.filter((j) => j.status === "COMPLETED");

  // Status reflects real work: a started route -> On Route; any active route ->
  // On Shift; otherwise the stored status. Never stuck "Off Shift" mid-route.
  const started = activeJobs.some((j) =>
    ["IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(j.status),
  );
  const displayStatus = started ? "ON_ROUTE" : activeJobs.length > 0 ? "ON_SHIFT" : driver.status;
  const isOnShift = displayStatus !== "OFF_SHIFT";
  const dotColor = STATUS_DOT[displayStatus] ?? "var(--muted-foreground-2)";

  return (
    <div
      className="pt-safe min-h-screen page-enter"
      style={{ paddingTop: "env(safe-area-inset-top, 0)" }}
    >
      {/* ── Header ── */}
      <div className="px-5 pt-6 pb-5 sticky top-0 z-20" style={{ background: "var(--background)" }}>
        <div className="flex items-start justify-between pr-12">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Welcome back
            </p>
            <h1 className="text-2xl font-bold mt-0.5 tracking-tight">{driver.name}</h1>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {/* Status chip */}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
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
                {STATUS_LABEL[displayStatus]}
              </span>
            </div>
            {equip.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                {equip.map((t) => (
                  <span
                    key={t}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border border-border bg-surface text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
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
            style={{ color: gps ? "var(--success)" : "var(--muted-foreground-2)" }}
          />
          <span style={{ color: gps ? "var(--success)" : undefined }}>
            {gps ? `GPS live · ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}` : "No GPS"}
          </span>
        </div>
      </div>

      <div className="px-4 space-y-6 pb-8">
        {gpsError && !gps && (
          <button
            type="button"
            onClick={() => {
              if (!navigator.geolocation) return;
              navigator.geolocation.getCurrentPosition(
                () => useDriverStore.getState().setGpsError(null),
                (err) =>
                  useDriverStore.getState().setGpsError({ code: err.code, message: err.message }),
                { enableHighAccuracy: true, timeout: 20000 },
              );
            }}
            className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-left active:scale-[0.99] transition"
          >
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <MapPin className="size-4" />
              <span className="text-sm font-semibold">Location tracking is off</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {gpsError.code === 1
                ? "Location permission is blocked. Tap here, then allow location for this site so your route can be tracked."
                : "Could not get a GPS fix. Tap to retry — check that location is on and you have signal."}
            </p>
          </button>
        )}
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
                background: "var(--surface)",
                border: "1px solid var(--border)",
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
