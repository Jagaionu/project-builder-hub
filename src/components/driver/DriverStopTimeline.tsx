import { haversineKm, etaMinutes, type GPSPosition } from "@/lib/driver-gps";
import type { JobWithStops } from "@/lib/driver-types";

interface Props {
  job: JobWithStops;
  driverPosition: GPSPosition | null;
  onArrive?: (stopId: string) => void;
}

export function DriverStopTimeline({ job, driverPosition, onArrive }: Props) {
  const stops = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);

  return (
    <ol className="relative space-y-0">
      {stops.map((stop, i) => {
        const isLast = i === stops.length - 1;
        const arrived = !!stop.arrived_at;
        const isNext = !arrived && stops.slice(0, i).every((s) => !!s.arrived_at);
        const wh = stop.warehouse;

        let eta: string | null = null;
        if (isNext && driverPosition && wh) {
          const dist = haversineKm(driverPosition.lat, driverPosition.lon, wh.latitude, wh.longitude);
          const mins = etaMinutes(dist);
          eta = mins < 2 ? "Arriving" : mins < 60 ? `~${mins} min` : `~${Math.round(mins / 60)}h`;
        }

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
                  <p className="font-semibold text-sm text-foreground">{kindIcon} {kindLabel}</p>
                  <p className="text-base font-bold text-foreground mt-0.5">{wh?.code} — {wh?.name}</p>
                  {wh?.address && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{wh.address}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {arrived ? (
                    <span className="text-xs text-success font-semibold">
                      ✓ {new Date(stop.arrived_at!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ) : eta ? (
                    <span className="text-xs text-primary font-mono">{eta}</span>
                  ) : null}
                </div>
              </div>
              {isNext && onArrive && (
                <button
                  onClick={() => onArrive(stop.id)}
                  className="mt-3 w-full bg-primary text-primary-foreground font-semibold text-sm rounded-lg py-2.5 active:scale-[0.98] transition"
                >
                  Mark arrived
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
