import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Clock } from "lucide-react";
import type { JobWithStops } from "@/lib/driver-types";

interface Props {
  job: JobWithStops;
  showTomorrow?: boolean;
}

export const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    bg: string;
    dot: string;
  }
> = {
  PENDING: {
    label: "Planned",
    color: "var(--muted-foreground)",
    bg: "var(--secondary)",
    dot: "var(--muted-foreground-2)",
  },
  ASSIGNED: {
    label: "Assigned",
    color: "var(--primary-bright)",
    bg: "oklch(0.62 0.22 245 / 0.12)",
    dot: "var(--primary)",
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "var(--success-fg)",
    bg: "oklch(0.73 0.17 150 / 0.10)",
    dot: "var(--success)",
  },
  ARRIVED_PICKUP: {
    label: "In Progress",
    color: "var(--success-fg)",
    bg: "oklch(0.73 0.17 150 / 0.10)",
    dot: "var(--success)",
  },
  EN_ROUTE_DELIVERY: {
    label: "In Progress",
    color: "var(--success-fg)",
    bg: "oklch(0.73 0.17 150 / 0.10)",
    dot: "var(--success)",
  },
  COMPLETED: {
    label: "Completed",
    color: "var(--success-fg)",
    bg: "oklch(0.73 0.17 150 / 0.08)",
    dot: "var(--success)",
  },
  CANCELLED: {
    label: "Cancelled",
    color: "var(--destructive-fg)",
    bg: "color-mix(in oklab, var(--destructive) 8%, transparent)",
    dot: "var(--destructive)",
  },
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
  const isActive = ["IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"].includes(job.status);

  const time = job.planned_start_at
    ? new Date(job.planned_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : job.scheduled_at
      ? new Date(job.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;

  return (
    <button
      onClick={() => navigate({ to: "/d/routes/$jobId", params: { jobId: job.id } })}
      className="driver-job-card w-full text-left"
      style={
        isActive
          ? {
              borderColor: "oklch(0.62 0.22 245 / 0.45)",
              boxShadow: "0 0 0 1px oklch(0.62 0.22 245 / 0.12), 0 8px 24px oklch(0 0 0 / 0.35)",
            }
          : {}
      }
    >
      {/* Active job — top accent line */}
      {isActive && (
        <div
          className="h-0.5 w-full"
          style={{
            background: "linear-gradient(90deg, var(--primary), var(--success))",
          }}
        />
      )}

      <div className="p-4 flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-foreground leading-tight">{job.reference}</p>
            {showTomorrow && (
              <p
                className="text-[11px] font-mono uppercase tracking-widest mt-0.5"
                style={{ color: "var(--primary)" }}
              >
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
            style={{
              background: "var(--secondary)",
              border: "1px solid var(--border)",
            }}
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
                  background:
                    arrived === total
                      ? "var(--success)"
                      : "linear-gradient(90deg, var(--primary), var(--success))",
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
