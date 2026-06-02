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
  jobs, selectedJobId, totalJobs, stopsMap, lookups, plannedByJob, onSelect, onShowTour,
}: {
  jobs: Job[];
  selectedJobId: string | null;
  totalJobs: number;
  stopsMap: JobStopsMap;
  lookups: Lookups;
  plannedByJob: Map<string, PlannedAssign>;
  onSelect: (id: string) => void;
  onShowTour: (driverId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const tourSize = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      const id = j.assigned_driver_id ?? plannedByJob.get(j.id)?.driverId ?? j.planned_driver_id ?? null;
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [jobs, plannedByJob]);

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
      style={{ background: "var(--background)" }}
    >
      <div
        className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground sticky top-0 z-10 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--sidebar-divider)", background: "color-mix(in oklab, var(--sidebar-bg-1) 95%, transparent)", backdropFilter: "blur(4px)" }}
      >
        <span>Queue</span>
        <span
          className="inline-flex items-center justify-center size-5 rounded-full text-[10px] font-mono font-bold"
          style={{ background: "oklch(0.62 0.22 245 / 0.12)", color: "var(--primary-bright)" }}
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
                  borderBottom: "1px solid var(--sidebar-divider)",
                }}
              >
                <QueueRow
                  job={job}
                  active={selectedJobId === job.id}
                  stopsMap={stopsMap}
                  lookups={lookups}
                  plannedByJob={plannedByJob}
                  onSelect={onSelect}
                  tourSize={tourSize}
                  onShowTour={onShowTour}
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
  job, active, stopsMap, lookups, plannedByJob, onSelect, tourSize, onShowTour,
}: {
  job: Job;
  active: boolean;
  stopsMap: JobStopsMap;
  lookups: Lookups;
  plannedByJob: Map<string, PlannedAssign>;
  onSelect: (id: string) => void;
  tourSize: Map<string, number>;
  onShowTour: (driverId: string) => void;
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
  const tourDriverId = job.assigned_driver_id ?? plannedDriverId ?? null;
  const tourCount = tourDriverId ? (tourSize.get(tourDriverId) ?? 0) : 0;
  const inTour = tourCount > 1;
  const tourSeq = planned?.sequence ?? job.planned_sequence ?? null;
  
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
        "w-full h-full text-left px-4 py-3 transition-colors border-l-2 pl-[calc(1rem-2px)]",
        active
          ? "bg-primary/10 border-l-primary"
          : inTour
            ? "border-l-[color:var(--primary-bright)]/50 hover:bg-surface"
            : "border-l-transparent hover:bg-surface",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-foreground tracking-tight">{job.reference}</span>
          {inTour && tourDriverId && (
            <span
              role="button"
              tabIndex={0}
              title="Show this driver's full tour"
              onClick={(e) => { e.stopPropagation(); onShowTour(tourDriverId); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onShowTour(tourDriverId); } }}
              className="inline-flex items-center gap-0.5 rounded-full bg-[color:var(--primary-bright)]/15 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-[color:var(--primary-bright)] cursor-pointer hover:bg-[color:var(--primary-bright)]/30"
            >
              <LinkIcon className="size-2.5" />
              Tour{tourSeq ? ` ${tourSeq}/${tourCount}` : ` ·${tourCount}`}
            </span>
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
            active ? "text-primary" : "text-foreground",
          )}
        >
          {o?.code ?? "?"}
        </span>
        <ArrowRight className="size-3 text-muted-foreground shrink-0" />
        <span
          className={cn(
            "font-semibold truncate",
            active ? "text-primary" : "text-foreground",
          )}
        >
          {d?.code ?? "?"}
        </span>
        {isMR && (
          <span className="ml-1 px-1 rounded text-[9px] font-mono font-bold bg-warning/15 text-warning">
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
              ? "text-primary"
              : plannedDriver
                ? "text-muted-foreground"
                : "text-muted-foreground/70",
          )}
        >
          {driver ? driver.name : plannedDriver ? `· ${plannedDriver.name}` : "Unassigned"}
        </span>
      </div>
    </button>
  );
});
