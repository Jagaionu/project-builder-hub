import { haversineKm, etaMinutes, atLocation, GPS_FRESH_MS, type GPSPosition } from "@/lib/driver-gps";
import { stopCriticalWindow } from "@/lib/geo";
import type { JobWithStops } from "@/lib/driver-types";

interface Props {
  job: JobWithStops;
  driverPosition: GPSPosition | null;
  onArrive?: (stopId: string) => void;
  plannedTimes?: (string | null)[];
  handlingMin?: number;
}

export function DriverStopTimeline({
  job,
  driverPosition,
  onArrive,
  plannedTimes,
  handlingMin,
}: Props) {
  const stops = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);

  return (
    <ol className="relative space-y-0">
      {stops.map((stop, i) => {
        const isLast = i === stops.length - 1;
        const arrived = !!stop.arrived_at;
        const isNext = !arrived && stops.slice(0, i).every((s) => !!s.arrived_at);
        const wh = stop.warehouse;
        const crit = plannedTimes?.[i] ?? stop.scheduled_at;
        const win = stopCriticalWindow(crit, stop.kind, handlingMin);
        const plannedArrival = win.arrival;
        const departedAt = (stop as { departed_at?: string | null }).departed_at ?? null;
        const canArrive = !!wh && atLocation(driverPosition, wh.latitude, wh.longitude);
        const distKm =
          wh && driverPosition
            ? haversineKm(driverPosition.lat, driverPosition.lon, wh.latitude, wh.longitude)
            : null;
        const gpsStaleOrMissing =
          !driverPosition || Date.now() - driverPosition.ts > GPS_FRESH_MS;

        const dotColor = arrived
          ? "bg-success border-success"
          : isNext
            ? "bg-primary border-primary animate-pulse"
            : "bg-muted border-border";

        const kindIcon = stop.kind === "PICKUP" ? "📦" : "🏁";
        const kindLabel = stop.kind === "PICKUP" ? "Pickup" : "Drop-off";

        return (
          <li key={stop.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${dotColor}`} />
              {!isLast && <div className="w-0.5 flex-1 bg-border my-1" />}
            </div>

            <div className="pb-5 flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-foreground">
                    {kindIcon} Stop {i + 1} — {kindLabel}
                  </p>
                  <p className="text-base font-bold text-foreground mt-0.5">
                    {wh?.code} — {wh?.name}
                  </p>
                  {wh?.address && (
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {wh.address}
                    </p>
                  )}
                  {plannedArrival && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      Planned{" "}
                      {new Date(plannedArrival).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {stop.kind === "PICKUP" && win.departure && (
                        <span className="text-muted-foreground/70">
                          {" "}
                          · pull by{" "}
                          {new Date(win.departure).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </p>
                  )}
                  {departedAt && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                      Departed{" "}
                      {new Date(departedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · GPS
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {arrived ? (
                    <span className="text-xs text-success font-semibold">
                      ✓{" "}
                      {new Date(stop.arrived_at!).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  ) : isNext ? (
                    <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">
                      Next
                    </span>
                  ) : null}
                </div>
              </div>
              {isNext && onArrive && (
                <div className="mt-2">
                  <button
                    type="button"
                    disabled={!canArrive}
                    onClick={() => canArrive && onArrive(stop.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                  >
                    I have arrived
                  </button>
                  {!canArrive && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {gpsStaleOrMissing
                        ? "Waiting for your location — turn on GPS to confirm arrival."
                        : distKm != null
                          ? "Move closer to confirm — about " +
                            (distKm < 1
                              ? Math.round(distKm * 1000) + " m"
                              : distKm.toFixed(1) + " km") +
                            " away."
                          : "Move closer to the stop to confirm arrival."}
                    </p>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
