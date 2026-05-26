import { memo, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRight, MapPin } from "lucide-react";
import type { Driver, Job, Warehouse } from "@/lib/types";
import { isJobScheduledFuture } from "@/lib/effective-status";
import type { JobStopsMap, Stop } from "@/lib/dispatch/use-job-stops";
import { STATUS_CONFIG, type EffectiveStatus } from "@/lib/dispatch/status";
import type { Lookups } from "@/lib/dispatch/lookups";
import { cn } from "@/lib/utils";

type PlannedAssign = { driverId: string; sequence: number; startAt: string };

export interface JobQueueProps {
  jobs: Job[];
  totalJobs: number;
  stopsMap: JobStopsMap;
  lookups: Lookups;
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  plannedByJob: Map<string, PlannedAssign>;
}

/**
 * Virtualized queue list — renders only the rows currently in view, so going
 * from 50 → 5000 jobs costs the same 16ms.
 */
export const JobQueue = memo(function JobQueue({
  jobs, totalJobs, stopsMap, lookups, selectedJobId, onSelectJob, plannedByJob,
}: JobQueueProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: jobs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 8,
  });

  const items = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className="border-r border-border overflow-y-auto h-full bg-[oklch(0.155_0.017_245)]"
    >
      <div
        className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground sticky top-0 z-10 flex items-center justify-between border-b border-[oklch(0.20_0.016_245)] bg-[oklch(0.15_0.018_245)/0.95] backdrop-blur"
      >
        <span>Queue</span>
        <span className="inline-flex items-center justify-center size-5 rounded-full text-[10px] font-mono font-bold bg-primary/10 text-primary">
          {jobs.length}
        </span>
      </div>

      {jobs.length === 0 ? (
        <div className="p-8 text-sm text-muted-foreground text-center">
          <MapPin className="size-8 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-xs">{totalJobs === 0 ? "No routes yet." : "No routes match your filters."}</p>
        </div>
      ) : (
        <div style={{ height: totalSize, position: "relative" }}>
          {items.map((vi) => {
            const job = jobs[vi.index];
            return (
              <div
                key={job.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <QueueRow
                  job={job}
                  stops={stopsMap[job.id] ?? EMPTY_STOPS}
                  lookups={lookups}
                  active={selectedJobId === job.id}
                  planned={plannedByJob.get(job.id) ?? null}
                  onSelect={onSelectJob}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const EMPTY_STOPS: Stop[] = [];

// ── QueueRow ─────────────────────────────────────────────────────────────────

const QueueRow = memo(function QueueRow({
  job, stops, lookups, active, planned, onSelect,
}: {
  job: Job;
  stops: Stop[];
  lookups: Lookups;
  active: boolean;
  planned: PlannedAssign | null;
  onSelect: (id: string) => void;
}) {
  const { warehousesById, driversById } = lookups;
  const o = warehousesById.get(stops[0]?.warehouse_id ?? "");
  const d = warehousesById.get(stops[stops.length - 1]?.warehouse_id ?? "");
  const driver = job.assigned_driver_id ? driversById.get(job.assigned_driver_id) : undefined;
  const plannedDriverId = planned?.driverId ?? job.planned_driver_id ?? null;
  const plannedDriver = !driver && plannedDriverId ? driversById.get(plannedDriverId) : null;
  const isMR = stops.length > 2;

  // Memoize the effectiveStatus calc — building the synthetic stop array
  // with .map() each render was a big chunk of the queue's CPU cost.
  const effectiveStatus: EffectiveStatus = useMemo(() => {
    const isFuture = isJobScheduledFuture(
      {
        ...job,
        stops: stops.map((s, idx) => ({
          seq: idx,
          kind: s.kind,
          warehouse_id: s.warehouse_id,
          scheduled_at: s.scheduled_at,
          arrived_at: s.arrived_at ?? null,
        })),
      },
      Date.now(),
    );
    return isFuture ? "SCHEDULED" : (job.status as EffectiveStatus);
  }, [job, stops]);

  const cfg = STATUS_CONFIG[effectiveStatus];

  return (
    <button
      onClick={() => onSelect(job.id)}
      className={cn(
        "w-full text-left px-4 py-3 transition-colors border-l-2",
        active
          ? "bg-primary/[0.08] border-primary"
          : "border-transparent hover:bg-[oklch(0.18_0.018_245)]",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono text-[11px] text-muted-foreground">{job.reference}</span>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider", cfg.badge)}>
          <span className={cn("size-1.5 rounded-full shrink-0", cfg.dot)} />
          {cfg.label}
        </span>
      </div>

      <div className="flex items-center gap-1.5 font-mono text-sm">
        <span className={cn("font-semibold truncate", active ? "text-[oklch(0.85_0.10_245)]" : "text-foreground/90")}>
          {o?.code ?? "?"}
        </span>
        <ArrowRight className="size-3 text-muted-foreground shrink-0" />
        <span className={cn("font-semibold truncate", active ? "text-[oklch(0.85_0.10_245)]" : "text-foreground/90")}>
          {d?.code ?? "?"}
        </span>
        {isMR && (
          <span className="ml-1 px-1 rounded text-[9px] font-mono font-bold bg-amber-500/10 text-amber-600">
            +{stops.length - 2}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground gap-2">
        <span className="font-mono">
          {job.scheduled_at
            ? new Date(job.scheduled_at).toLocaleString(undefined, {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })
            : "ASAP"}
        </span>
        <span
          className={cn(
            "truncate",
            driver ? "text-[oklch(0.68_0.10_245)]"
              : plannedDriver ? "text-[oklch(0.60_0.08_245)]"
                : "text-muted-foreground/60",
          )}
        >
          {driver ? driver.name : plannedDriver ? `· ${plannedDriver.name}` : "Unassigned"}
        </span>
      </div>
    </button>
  );
}, (prev, next) =>
  prev.job === next.job &&
  prev.stops === next.stops &&
  prev.active === next.active &&
  prev.planned === next.planned &&
  prev.lookups === next.lookups,
);
