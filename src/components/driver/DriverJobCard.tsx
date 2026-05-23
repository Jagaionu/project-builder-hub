import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Clock } from "lucide-react";
import type { JobWithStops } from "@/lib/driver-types";

interface Props {
  job: JobWithStops;
  showTomorrow?: boolean;
}

export const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  bg: string;
  dot: string;
}> = {
  PENDING:           { label: "Planned",     color: "oklch(0.58 0.016 245)",  bg: "oklch(0.22 0.018 245)",        dot: "oklch(0.45 0.012 245)" },
  ASSIGNED:          { label: "Assigned",    color: "oklch(0.75 0.18 245)",   bg: "oklch(0.62 0.22 245 / 0.12)", dot: "oklch(0.62 0.22 245)" },
  IN_PROGRESS:       { label: "In Progress", color: "oklch(0.78 0.14 150)",   bg: "oklch(0.73 0.17 150 / 0.10)", dot: "oklch(0.73 0.17 150)" },
  ARRIVED_PICKUP:    { label: "At Pickup",   color: "oklch(0.80 0.16 72)",    bg: "oklch(0.80 0.18 72  / 0.10)", dot: "oklch(0.80 0.18 72)" },
  EN_ROUTE_DELIVERY: { label: "En Route",    color: "oklch(0.75 0.18 245)",   bg: "oklch(0.62 0.22 245 / 0.12)", dot: "oklch(0.62 0.22 245)" },
  COMPLETED:         { label: "Completed",   color: "oklch(0.73 0.14 150)",   bg: "oklch(0.73 0.17 150 / 0.08)", dot: "oklch(0.73 0.17 150)" },
  CANCELLED:         { label: "Cancelled",   color: "oklch(0.63 0.18 20)",    bg: "oklch(0.63 0.22 20  / 0.08)", dot: "oklch(0.63 0.22 20)" },
};

export function DriverJobCard({ job, showTomorrow }: Props) {
  const navigate = useNavigate();
  const cfg    = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.PENDING;
  const stops  = job.stops ?? [];
  const pickups = stops.filter((s) => s.kind === "PICKUP");
  const drops   = stops.filter((s) => s.kind === "DROP");
  const arrived = stops.filter((s) => s.arrived_at).length;
  const total   = stops.length;
  const startWh = pickups[0]?.warehouse;
  const endWh   = drops[drops.length - 1]?.warehouse;
  const isActive = ["IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"].includes(job.status);

  const time = job.planned_start_at
    ? new Date(job.planned_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : job.scheduled_at
    ? new Date(job.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <button
      onClick={() => navigate({ to: "/d/routes/$jobId", params: { jobId: job.id } })}
      className="driver-job-card w-full text-left"
      style={isActive ? {
        borderColor: "oklch(0.62 0.22 245 / 0.45)",
        boxShadow: "0 0 0 1px oklch(0.62 0.22 245 / 0.12), 0 8px 24px oklch(0 0 0 / 0.35)",
      } : {}}
    >
      {/* Active job — top accent line */}
      {isActive && (
        <div
          className="h-0.5 w-full"
          style={{
            background: "linear-gradient(90deg, oklch(0.62 0.22 245), oklch(0.73 0.17 150))",
          }}
        />
      )}

      <div className="p-4 flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-foreground leading-tight">{job.reference}</p>
            {showTomorrow && (
              <p className="text-[11px] font-mono uppercase tracking-widest mt-0.5"
                style={{ color: "oklch(0.62 0.22 245)" }}>
                Tomorrow
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {time && (
              <span className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                <Clock className="size-3" />
                {time}
              </span>
            )}
            {/* Status badge */}
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold"
              style={{ color: cfg.color, background: cfg.bg }}
            >
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ background: cfg.dot, boxShadow: isActive ? `0 0 4px ${cfg.dot}` : "none" }}
              />
              {cfg.label}
            </span>
          </div>
        </div>

        {/* Route: pickup → drop */}
        <div className="flex items-center gap-2">
          {/* Pickup */}
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground leading-none mb-0.5">
              {pickups.length > 1 ? `${pickups.length} pickups` : "Pickup"}
            </p>
            <p className="text-sm font-semibold text-foreground truncate leading-tight">
              {startWh?.code ?? "—"}
            </p>
            {startWh?.name && (
              <p className="text-[11px] text-muted-foreground truncate mt-0.5 leading-tight">
                {startWh.name}
              </p>
            )}
          </div>

          {/* Arrow */}
          <div
            className="shrink-0 size-7 rounded-full grid place-items-center"
            style={{ background: "oklch(0.22 0.018 245)", border: "1px solid oklch(0.26 0.018 245)" }}
          >
            <ArrowRight className="size-3.5 text-muted-foreground" />
          </div>

          {/* Drop */}
          <div className="flex-1 min-w-0 text-right">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground leading-none mb-0.5">
              {drops.length > 1 ? `${drops.length} drops` : "Drop"}
            </p>
            <p className="text-sm font-semibold text-foreground truncate leading-tight">
              {endWh?.code ?? "—"}
            </p>
            {endWh?.name && (
              <p className="text-[11px] text-muted-foreground truncate mt-0.5 leading-tight">
                {endWh.name}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {total > 0 && (
          <div className="space-y-1">
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${(arrived / total) * 100}%`,
                  background: arrived === total
                    ? "oklch(0.73 0.17 150)"
                    : "linear-gradient(90deg, oklch(0.62 0.22 245), oklch(0.73 0.17 150))",
                }}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-muted-foreground">
                {arrived === 0 ? "Not started" : `${arrived} of ${total} stops`}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {arrived}/{total}
              </span>
            </div>
          </div>
        )}
      </div>
    </button>
  );
}
