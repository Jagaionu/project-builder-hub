// DriverItineraryTimeline.tsx
import { MapPin, ArrowRight, CheckCircle2, Clock, Package, Truck, Info } from "lucide-react";
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

// ─── Tooltip Component ──────────────────────────────────────────────────────

function Tooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  return (
    <div className="group relative inline-block">
      {children}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {content}
        <div className="absolute top-full left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-b border-r border-border bg-popover" />
      </div>
    </div>
  );
}

// ─── redesigned layout rows ─────────────────────────────────────────────────

function LegRowItem({ row }: { row: LegRow }) {
  return (
    <div className="relative flex items-center gap-4 pl-3 pr-1 py-3 group/leg">
      {/* Schematic Line Assembly */}
      <div className="absolute left-[21px] top-0 bottom-0 w-0.5 border-l-2 border-dashed border-muted/60" />

      {/* Minor Icon Placement */}
      <div className="z-10 flex size-5 items-center justify-center rounded-full border border-muted-foreground/20 bg-background shadow-sm text-muted-foreground">
        <Truck className="size-3" />
      </div>

      {/* Simplified Main UI String */}
      <div className="flex flex-1 items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>Transit</span>
          <ArrowRight className="size-3 text-muted-foreground/50" />
          <span className="text-foreground font-semibold">{row.toLabel}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-semibold text-primary">{row.minutes} min</span>

          <Tooltip
            content={
              <div className="space-y-1 font-sans">
                <p className="font-semibold text-foreground border-b pb-1 mb-1">
                  Route Vector Data
                </p>
                <p>
                  <span className="text-muted-foreground">Origin:</span> {row.fromLabel}
                </p>
                <p>
                  <span className="text-muted-foreground">Destination:</span> {row.toLabel}
                </p>
                <p>
                  <span className="text-muted-foreground">Est. Distance:</span> {fmtKm(row.km)}
                </p>
                <p>
                  <span className="text-muted-foreground">Planned Window:</span>{" "}
                  {fmtTime(row.departsAt)} - {fmtTime(row.arrivesAt)}
                </p>
              </div>
            }
          >
            <Info className="size-3.5 text-muted-foreground/60 hover:text-foreground cursor-pointer" />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function StopRowItem({ row }: { row: StopRow }) {
  const isPickup = row.stopKind === "PICKUP";

  return (
    <div className="relative flex items-start gap-4 pl-3 pr-1 py-2 group/stop">
      {/* Continuous Axis Line Lineage */}
      <div className="absolute left-[21px] top-0 bottom-0 w-0.5 bg-border" />

      {/* Node Anchor */}
      <div
        className={`z-10 flex size-5 shrink-0 items-center justify-center rounded-full border shadow-sm transition-colors
        ${
          row.arrivedAt
            ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
            : isPickup
              ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
              : "border-blue-500/60 bg-blue-500/10 text-blue-400"
        }`}
      >
        {row.arrivedAt ? <CheckCircle2 className="size-3" /> : <MapPin className="size-3" />}
      </div>

      {/* Simplified Structural Board */}
      <div className="flex-1 min-w-0 bg-surface border border-border/60 hover:border-border rounded-md px-3 py-2 flex items-center justify-between transition-all">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm text-foreground tracking-tight">
              {row.code}
            </span>
            <span
              className={`text-[10px] font-medium font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border
              ${
                isPickup
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                  : "bg-blue-500/10 border-blue-500/30 text-blue-400"
              }`}
            >
              {isPickup ? "Pickup" : "Drop-off"}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> ETA {fmtTime(row.plannedAt)}
            </span>
            {row.dwellMinutes != null && row.dwellMinutes > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground/80">
                <Package className="size-3" /> {row.dwellMinutes}m dwell
              </span>
            )}
          </div>
        </div>

        {/* Informative Interaction Node */}
        <div className="flex items-center gap-2">
          {row.arrivedAt && (
            <span className="text-[11px] font-mono font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
              Arrived {fmtTime(row.arrivedAt)}
            </span>
          )}

          <Tooltip
            content={
              <div className="space-y-1 font-sans">
                <p className="font-semibold text-foreground border-b pb-1 mb-1">
                  Stop Execution Detail
                </p>
                <p>
                  <span className="text-muted-foreground">Node Code:</span> {row.code}
                </p>
                <p>
                  <span className="text-muted-foreground">Operation:</span> {row.stopKind}
                </p>
                <p>
                  <span className="text-muted-foreground">Target Slot:</span>{" "}
                  {fmtTime(row.plannedAt)}
                </p>
                <p>
                  <span className="text-muted-foreground">Actual Time:</span>{" "}
                  {row.arrivedAt ? fmtTime(row.arrivedAt) : "Pending Activation"}
                </p>
              </div>
            }
          >
            <Info className="size-3.5 text-muted-foreground/60 hover:text-foreground cursor-pointer" />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function SeparatorRowItem({ row }: { row: SeparatorRow }) {
  return (
    <div className="relative flex items-center py-4 pl-3">
      <div className="absolute left-[21px] top-0 bottom-0 w-0.5 bg-border" />
      <div className="z-10 -ml-1 h-2 w-2 rounded-full bg-border" />
      <span className="ml-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground bg-background pr-2 font-bold">
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
    <div className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2 border-b border-border pb-3">
        <Truck className="size-4 text-primary" />
        Driver Workflow Schematic
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 border border-dashed rounded-lg border-border bg-surface">
          <p className="text-xs text-muted-foreground font-mono">
            No assignments found for current processing date
          </p>
        </div>
      ) : (
        <div className="relative flex flex-col pl-1">
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
