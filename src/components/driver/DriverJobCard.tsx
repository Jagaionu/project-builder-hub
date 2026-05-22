import { useNavigate } from "@tanstack/react-router";
import type { JobWithStops } from "@/lib/driver-types";

interface Props {
  job: JobWithStops;
  showTomorrow?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:           { label: "Planned",     color: "text-muted-foreground", bg: "bg-muted" },
  ASSIGNED:          { label: "Assigned",    color: "text-primary",          bg: "bg-primary/15" },
  IN_PROGRESS:       { label: "In Progress", color: "text-success",          bg: "bg-success/15" },
  ARRIVED_PICKUP:    { label: "At Pickup",   color: "text-warning",          bg: "bg-warning/15" },
  EN_ROUTE_DELIVERY: { label: "En Route",    color: "text-primary",          bg: "bg-primary/15" },
  COMPLETED:         { label: "Completed",   color: "text-success",          bg: "bg-success/15" },
  CANCELLED:         { label: "Cancelled",   color: "text-destructive",      bg: "bg-destructive/15" },
};

export function DriverJobCard({ job, showTomorrow }: Props) {
  const navigate = useNavigate();
  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.PENDING;
  const stops = job.stops ?? [];
  const pickups = stops.filter((s) => s.kind === "PICKUP");
  const drops = stops.filter((s) => s.kind === "DROP");
  const arrived = stops.filter((s) => s.arrived_at).length;
  const total = stops.length;
  const startWh = pickups[0]?.warehouse;
  const endWh = drops[drops.length - 1]?.warehouse;

  const time = job.planned_start_at
    ? new Date(job.planned_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : job.scheduled_at
    ? new Date(job.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <button
      onClick={() => navigate({ to: "/d/routes/$jobId", params: { jobId: job.id } })}
      className="w-full text-left bg-card border border-border rounded-xl p-4 flex flex-col gap-3 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{job.reference}</p>
          {showTomorrow && <p className="text-xs text-primary font-medium mt-0.5">Tomorrow</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {time && <span className="text-xs text-muted-foreground font-mono">{time}</span>}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.color} ${cfg.bg}`}>{cfg.label}</span>
        </div>
      </div>

      <div className="flex items-start gap-2 text-sm">
        <div className="flex-1 min-w-0">
          <p className="text-muted-foreground truncate">📦 {startWh?.code ?? "—"}</p>
          <p className="text-foreground truncate font-medium">{startWh?.name ?? "Pickup"}</p>
          {startWh?.address && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{startWh.address}</p>
          )}
        </div>
        <span className="text-muted-foreground mt-1">→</span>
        <div className="flex-1 min-w-0 text-right">
          <p className="text-muted-foreground truncate">🏁 {endWh?.code ?? "—"}</p>
          <p className="text-foreground truncate font-medium">{endWh?.name ?? "Drop-off"}</p>
          {endWh?.address && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{endWh.address}</p>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full transition-all" style={{ width: `${(arrived / total) * 100}%` }} />
          </div>
          <span className="text-xs text-muted-foreground font-mono">{arrived}/{total}</span>
        </div>
      )}
    </button>
  );
}
