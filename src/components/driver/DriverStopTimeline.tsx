import { haversineKm, etaMinutes, type GPSPosition } from "@/lib/driver-gps";
import type { JobWithStops } from "@/lib/driver-types";

interface Props {
  job: JobWithStops;
  driverPosition: GPSPosition | null;
  onArrive?: (stopId: string) => void;
  plannedTimes?: (string | null)[];
}

export function DriverStopTimeline({ job, driverPosition, onArrive, plannedTimes }: Props) {
  const stops = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);

  return (
    <ol className="relative space-y-0">
      {stops.map((stop, i) => {
        const isLast = i === stops.length - 1;
        const arrived = !!stop.arrived_at;
        const isNext = !arrived && stops.slice(0, i).every((s) => !!s.arrived_at);
        const wh = stop.warehouse;
        const plannedAt = plannedTimes?.[i] ?? stop.scheduled_at;
        const departedAt = (stop as { departed_at?: string | null }).departed_at ?? null;

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
                  <p className="text-base font-bold text-foreground mt-0.5">{wh?.code} — {wh?.name}</p>
                  {wh?.address && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{wh.address}</p>}
                  {plannedAt && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      Planned {new Date(plannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                  {departedAt && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                      Departed {new Date(departedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · GPS
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {arrived ? (
                    <span className="text-xs text-success font-semibold">
                      ✓ {new Date(stop.arrived_at!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ) : isNext ? (
                    <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">Next</span>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
