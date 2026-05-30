import { memo, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRight, Link as LinkIcon, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { isJobScheduledFuture } from "@/lib/effective-status";
import type { Job } from "@/lib/types";
import type { JobStopsMap } from "@/lib/dispatch/use-job-stops";
import type { Lookups } from "@/lib/dispatch/lookups";
import { STATUS_CONFIG, type EffectiveStatus } from "@/lib/dispatch/status";
import type { PlannedAssign } from "@/lib/planner";

const ROW_HEIGHT = 76;

export const JobQueue = memo(function JobQueue({
  jobs, selectedJobId, totalJobs, stopsMap, lookups, plannedByJob, onSelect,
}: {
  jobs: Job[];
  selectedJobId: string | null;
  totalJobs: number;
  stopsMap: JobStopsMap;
  lookups: Lookups;
  plannedByJob: Map<string, PlannedAssign>;
  onSelect: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: jobs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => jobs[index]?.id ?? index,
  });

  return (
    <div
      ref={parentRef}
      className="border-r border-border overflow-y-auto h-full"
      style={{ background: "oklch(0.155 0.017 245)" }}
    >
      <div
        className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground sticky top-0 z-10 flex items-center justify-between"
        style={{ borderBottom: "1px solid oklch(0.20 0.016 245)", background: "oklch(0.15 0.018 245 / 0.95)", backdropFilter: "blur(4px)" }}
      >
        <span>Queue</span>
        <span
          className="inline-flex items-center justify-center size-5 rounded-full text-[10px] font-mono font-bold"
          style={{ background: "oklch(0.62 0.22 245 / 0.12)", color: "oklch(0.75 0.18 245)" }}
        >
          {jobs.length}
        </span>
      </div>

      {jobs.length === 0 ? (
        <div className="p-8 text-sm text-muted-foreground text-center">
          <MapPin className="size-8 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-xs">{totalJobs === 0 ? "No routes yet." : "No routes match your filters."}</p>
        </div>
      ) : (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const job = jobs[vi.index];
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                  borderBottom: "1px solid oklch(0.20 0.016 245)",
                }}
              >
                <QueueRow
                  job={job}
                  active={selectedJobId === job.id}
                  stopsMap={stopsMap}
                  lookups={lookups}
                  plannedByJob={plannedByJob}
                  onSelect={onSelect}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const QueueRow = memo(function QueueRow({
  job, active, stopsMap, lookups, plannedByJob, onSelect,
}: {
  job: Job;
  active: boolean;
  stopsMap: JobStopsMap;
  lookups: Lookups;
  plannedByJob: Map<string, PlannedAssign>;
  onSelect: (id: string) => void;
}) {
  const stops = stopsMap[job.id] ?? [];
  const o = stops[0]?.warehouse_id ? lookups.warehousesById.get(stops[0].warehouse_id) : null;
  const d = stops.length ? lookups.warehousesById.get(stops[stops.length - 1].warehouse_id) : null;
  const driver = job.assigned_driver_id ? lookups.driversById.get(job.assigned_driver_id) : null;

  const planned = plannedByJob.get(job.id);
  const plannedDriverId = planned?.driverId ?? job.planned_driver_id ?? null;
  const plannedDriver = !driver && plannedDriverId ? lookups.driversById.get(plannedDriverId) : null;
  
  // Chaining indicator: job is planned and has a sequence > 1, 
  // OR it's planned and there are other jobs planned for the same driver.
  const isChained = !!(plannedDriverId && (planned?.sequence && planned.sequence > 1 || job.planned_sequence && job.planned_sequence > 1));
  
  const isMR = stops.length > 2;

  const effectiveStatus: EffectiveStatus = useMemo(() => {
    return isJobScheduledFuture(
      {
        ...job,
        stops: stops.map((s, idx) => ({
          seq: idx, kind: s.kind, warehouse_id: s.warehouse_id,
          scheduled_at: s.scheduled_at, arrived_at: s.arrived_at ?? null,
        })),
      },
      Date.now(),
    ) ? "SCHEDULED" : job.status;
  }, [job, stops]);

  const cfg = STATUS_CONFIG[effectiveStatus];

  return (
    <button
      onClick={() => onSelect(job.id)}
      className={cn(
        "w-full h-full text-left px-4 py-3 transition-colors",
        active
          ? "bg-[oklch(0.62_0.22_245/0.08)] border-l-2 border-l-[oklch(0.62_0.22_245)] pl-[calc(1rem-2px)]"
          : "border-l-2 border-l-transparent hover:bg-[oklch(0.18_0.018_245)]",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{job.reference}</span>
          {isChained && (
            <LinkIcon className="size-3 text-[oklch(0.75_0.18_245)]" />
          )}
        </div>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider", cfg.badge)}>
          <span className={cn("size-1.5 rounded-full shrink-0", cfg.dot)} />
          {cfg.label}
        </span>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-sm">
        <span
          className={cn(
            "font-semibold truncate",
            active ? "text-[oklch(0.85_0.10_245)]" : "text-[oklch(0.88_0.008_240)]",
          )}
        >
          {o?.code ?? "?"}
        </span>
        <ArrowRight className="size-3 text-muted-foreground shrink-0" />
        <span
          className={cn(
            "font-semibold truncate",
            active ? "text-[oklch(0.85_0.10_245)]" : "text-[oklch(0.88_0.008_240)]",
          )}
        >
          {d?.code ?? "?"}
        </span>
        {isMR && (
          <span className="ml-1 px-1 rounded text-[9px] font-mono font-bold bg-[oklch(0.80_0.18_72/0.12)] text-[oklch(0.80_0.16_72)]">
            +{stops.length - 2}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground gap-2">
        <span className="font-mono">
          {job.scheduled_at
            ? new Date(job.scheduled_at).toLocaleString(undefined, {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
              })
            : "ASAP"}
        </span>
        <span
          className={cn(
            "truncate",
            driver
              ? "text-[oklch(0.68_0.10_245)]"
              : plannedDriver
                ? "text-[oklch(0.60_0.08_245)]"
                : "text-[oklch(0.42_0.010_245)]",
          )}
        >
          {driver ? driver.name : plannedDriver ? `· ${plannedDriver.name}` : "Unassigned"}
        </span>
      </div>
    </button>
  );
});
