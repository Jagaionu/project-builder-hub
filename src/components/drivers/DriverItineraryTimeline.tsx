// DriverItineraryTimeline.tsx
import { MapPin, ArrowRight, CheckCircle2, Clock, Package, Truck, Info, MoreHorizontal, Calendar, Navigation } from "lucide-react";
import type { Driver } from "@/lib/types";
import type { ActiveJob, ActiveStop } from "@/lib/use-driver-routes";
import { haversineKm, etaMinutes } from "@/lib/driver-gps";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function jobDate(job: ActiveJob): string | null {
  if (job.for_date) return job.for_date.slice(0, 10);
  const first = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq)[0];
  if (first?.scheduled_at) return first.scheduled_at.slice(0, 10);
  if (job.planned_start_at) return job.planned_start_at.slice(0, 10);
  if (job.scheduled_at) return job.scheduled_at.slice(0, 10);
  return null;
}

function jobSortMs(job: ActiveJob): number {
  const iso =
    job.planned_start_at ??
    [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq)[0]?.scheduled_at ??
    job.scheduled_at;
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Infinity;
}

// ─── types for the rendered timeline rows ───────────────────────────────────

type LegRow = {
  kind: "leg";
  fromLabel: string;
  toLabel: string;
  km: number;
  minutes: number;
  departsAt: string | null;
  arrivesAt: string | null;
};

type StopRow = {
  kind: "stop";
  code: string;
  name: string | null;
  stopKind: "PICKUP" | "DROP";
  plannedAt: string | null;
  arrivedAt: string | null;
  dwellMinutes: number | null;
};

type SeparatorRow = {
  kind: "separator";
  label: string;
};

type TimelineRow = LegRow | StopRow | SeparatorRow;

function buildRows(driver: Driver, jobs: ActiveJob[]): TimelineRow[] {
  const today = todayLocal();
  const todayJobs = jobs
    .filter((j) => jobDate(j) === today)
    .sort((a, b) => jobSortMs(a) - jobSortMs(b));

  if (todayJobs.length === 0) return [];

  const rows: TimelineRow[] = [];
  let curLat = driver.current_lat;
  let curLon = driver.current_lon;
  let curLabel = "Current Position";
  let curTimeIso: string | null = null;

  for (let ji = 0; ji < todayJobs.length; ji++) {
    const job = todayJobs[ji];
    const stops = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);

    if (ji > 0) {
      rows.push({
        kind: "separator",
        label: `Next Job · ${(job as { reference?: string }).reference ?? job.id.slice(0, 8).toUpperCase()}`,
      });
    }

    for (let si = 0; si < stops.length; si++) {
      const stop = stops[si];
      const wh = stop.warehouse;

      const toLabel = wh ? `${wh.code}` : "Unknown Warehouse";
      const toLat = wh?.latitude ?? null;
      const toLon = wh?.longitude ?? null;

      let km = 0;
      let mins = 0;
      if (curLat != null && curLon != null && toLat != null && toLon != null) {
        km = haversineKm(curLat, curLon, toLat, toLon);
        mins = etaMinutes(km);
      }

      let departsAt: string | null = curTimeIso;
      if (si === 0 && ji === 0) {
        departsAt = job.planned_start_at ?? curTimeIso;
      }

      let arrivesAt: string | null = null;
      if (departsAt) {
        const depMs = new Date(departsAt).getTime();
        if (Number.isFinite(depMs)) {
          arrivesAt = new Date(depMs + mins * 60_000).toISOString();
        }
      }
      if (stop.scheduled_at) arrivesAt = stop.scheduled_at;

      rows.push({
        kind: "leg",
        fromLabel: curLabel,
        toLabel,
        km,
        minutes: mins,
        departsAt,
        arrivesAt,
      });

      let dwellMinutes: number | null = null;
      const nextStop = stops[si + 1] ?? todayJobs[ji + 1]?.stops?.[0];
      if (stop.scheduled_at && nextStop?.scheduled_at) {
        const diff =
          (new Date(nextStop.scheduled_at).getTime() - new Date(stop.scheduled_at).getTime()) /
          60_000;
        if (diff > 0) dwellMinutes = Math.round(diff);
      }

      rows.push({
        kind: "stop",
        code: wh?.code ?? "?",
        name: null,
        stopKind: stop.kind,
        plannedAt: stop.scheduled_at,
        arrivedAt: stop.arrived_at,
        dwellMinutes,
      });

      curLat = toLat;
      curLon = toLon;
      curLabel = toLabel;
      curTimeIso = stop.scheduled_at ?? arrivesAt;
    }
  }

  return rows;
}

// ─── Tooltip Component (modernized) ────────────────────────────────────────

function Tooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  return (
    <div className="group relative inline-flex">
      {children}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-3 w-72 -translate-x-1/2 rounded-xl border border-white/10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl p-4 text-xs text-foreground shadow-2xl opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 translate-y-1">
        <div className="relative">
          {content}
          <div className="absolute -bottom-2 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-white/10 bg-white/90 dark:bg-gray-900/90" />
        </div>
      </div>
    </div>
  );
}

// ─── redesigned layout rows ─────────────────────────────────────────────────

function LegRowItem({ row }: { row: LegRow }) {
  return (
    <div className="relative flex items-center gap-4 pl-3 pr-1 py-2 group/leg transition-all duration-200 hover:bg-muted/20 rounded-lg">
      {/* Timeline line - dashed for legs */}
      <div className="absolute left-[21px] top-0 bottom-0 w-0.5 border-l-2 border-dashed border-muted-foreground/20" />

      {/* Icon with pulse effect */}
      <div className="z-10 flex size-6 items-center justify-center rounded-full border border-muted-foreground/20 bg-background shadow-sm transition-all group-hover/leg:border-primary/40 group-hover/leg:shadow-md">
        <Truck className="size-3.5 text-muted-foreground group-hover/leg:text-primary transition-colors" />
      </div>

      {/* Main content */}
      <div className="flex flex-1 items-center justify-between rounded-lg border border-transparent bg-card/50 px-3 py-2 transition-all group-hover/leg:border-border/60 group-hover/leg:bg-muted/10">
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-muted-foreground">Transit</span>
          <ArrowRight className="size-3 text-muted-foreground/40" />
          <span className="font-semibold text-foreground">{row.toLabel}</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <Navigation className="size-3.5" />
            {row.minutes} min
          </span>
          <span className="text-xs text-muted-foreground/60 font-mono">
            {fmtKm(row.km)}
          </span>

          <Tooltip
            content={
              <div className="space-y-2 font-sans">
                <p className="font-semibold text-foreground border-b border-border/40 pb-1.5 mb-1.5 flex items-center gap-2">
                  <Navigation className="size-3.5 text-primary" />
                  Route Vector Data
                </p>
                <div className="space-y-1 text-muted-foreground">
                  <p><span className="text-foreground/70">Origin:</span> {row.fromLabel}</p>
                  <p><span className="text-foreground/70">Destination:</span> {row.toLabel}</p>
                  <p><span className="text-foreground/70">Est. Distance:</span> {fmtKm(row.km)}</p>
                  <p><span className="text-foreground/70">Planned Window:</span> {fmtTime(row.departsAt)} – {fmtTime(row.arrivesAt)}</p>
                </div>
              </div>
            }
          >
            <Info className="size-3.5 text-muted-foreground/40 hover:text-foreground cursor-pointer transition-colors" />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function StopRowItem({ row }: { row: StopRow }) {
  const isPickup = row.stopKind === "PICKUP";
  const isArrived = !!row.arrivedAt;

  // Color scheme
  const accentColor = isArrived ? "emerald" : isPickup ? "amber" : "blue";
  const accentClass = `border-${accentColor}-500/40 bg-${accentColor}-500/10 text-${accentColor}-400`;

  return (
    <div className="relative flex items-start gap-4 pl-3 pr-1 py-2 group/stop transition-all duration-200">
      {/* Continuous line */}
      <div className="absolute left-[21px] top-0 bottom-0 w-0.5 bg-border/60" />

      {/* Node with status */}
      <div
        className={`z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 shadow-sm transition-all group-hover/stop:scale-105 group-hover/stop:shadow-md
        ${isArrived ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400" : "border-muted-foreground/30 bg-background text-muted-foreground"}
        ${!isArrived && isPickup ? "border-amber-500/50 bg-amber-500/10 text-amber-400" : ""}
        ${!isArrived && !isPickup ? "border-blue-500/50 bg-blue-500/10 text-blue-400" : ""}`}
      >
        {isArrived ? <CheckCircle2 className="size-3.5" /> : <MapPin className="size-3.5" />}
      </div>

      {/* Card-like stop block */}
      <div className="flex-1 min-w-0 rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm px-4 py-3 shadow-sm transition-all group-hover/stop:border-border group-hover/stop:shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="font-mono font-bold text-sm text-foreground tracking-tight">
              {row.code}
            </span>
            <span
              className={`text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${accentClass}`}
            >
              {isPickup ? "Pickup" : "Drop-off"}
            </span>
            {isArrived && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="size-3" />
                Arrived {fmtTime(row.arrivedAt)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              <span>ETA {fmtTime(row.plannedAt)}</span>
            </span>
            {row.dwellMinutes != null && row.dwellMinutes > 0 && (
              <span className="flex items-center gap-1.5 text-muted-foreground/70">
                <Package className="size-3.5" />
                <span>{row.dwellMinutes}m dwell</span>
              </span>
            )}
          </div>

          <Tooltip
            content={
              <div className="space-y-2 font-sans">
                <p className="font-semibold text-foreground border-b border-border/40 pb-1.5 mb-1.5 flex items-center gap-2">
                  <MapPin className="size-3.5 text-primary" />
                  Stop Execution Detail
                </p>
                <div className="space-y-1 text-muted-foreground">
                  <p><span className="text-foreground/70">Node Code:</span> {row.code}</p>
                  <p><span className="text-foreground/70">Operation:</span> {row.stopKind}</p>
                  <p><span className="text-foreground/70">Target Slot:</span> {fmtTime(row.plannedAt)}</p>
                  <p><span className="text-foreground/70">Actual Time:</span> {row.arrivedAt ? fmtTime(row.arrivedAt) : "Pending Activation"}</p>
                </div>
              </div>
            }
          >
            <Info className="size-3.5 text-muted-foreground/40 hover:text-foreground cursor-pointer transition-colors" />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function SeparatorRowItem({ row }: { row: SeparatorRow }) {
  return (
    <div className="relative flex items-center py-5 pl-3">
      <div className="absolute left-[21px] top-0 bottom-0 w-0.5 bg-border/60" />
      <div className="z-10 -ml-1 h-2.5 w-2.5 rounded-full bg-border/80 ring-4 ring-background" />
      <span className="ml-5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70 bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full border border-border/40">
        {row.label}
      </span>
    </div>
  );
}

// ─── main layout shell ──────────────────────────────────────────────────────

interface DriverItineraryTimelineProps {
  driver: Driver;
  jobs: ActiveJob[];
}

export function DriverItineraryTimeline({ driver, jobs }: DriverItineraryTimelineProps) {
  const rows = buildRows(driver, jobs);

  return (
    <div className="rounded-2xl border border-border/60 bg-gradient-to-b from-card/90 to-card/50 backdrop-blur-sm p-6 text-card-foreground shadow-lg shadow-black/5 transition-all">
      {/* Header with modern badge */}
      <div className="flex items-center justify-between mb-6 border-b border-border/50 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Truck className="size-4" />
          </div>
          <span className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
            Driver Workflow Schematic
          </span>
          <span className="ml-2 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
            {rows.length > 0 ? `${rows.filter(r => r.kind === 'stop').length} stops` : 'No stops'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60 font-mono">
          <Calendar className="size-3.5" />
          <span>{todayLocal()}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed rounded-2xl border-border/60 bg-muted/10">
          <Truck className="size-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground font-mono">
            No assignments for today
          </p>
        </div>
      ) : (
        <div className="relative flex flex-col pl-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {rows.map((row, i) => {
            if (row.kind === "leg") return <LegRowItem key={`leg-${i}`} row={row} />;
            if (row.kind === "stop") return <StopRowItem key={`stop-${i}`} row={row} />;
            return <SeparatorRowItem key={`sep-${i}`} row={row} />;
          })}
        </div>
      )}
    </div>
  );
}
