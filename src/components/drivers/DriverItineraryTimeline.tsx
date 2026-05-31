// DriverItineraryTimeline.tsx
//
// Chronological "Today's Itinerary" for the driver detail panel.
// Shows every leg + stop the planner assigned to this driver today:
//   leg  → <from> ── X km · Y min ──▶ <to>   (departure → arrival)
//   stop → warehouse code/name, kind, planned arrival, dwell, ✓ actual
//
// Pure presentational. All distance/time via haversineKm + etaMinutes
// (same 55 kph average the planner uses). No DB writes.

import { MapPin, ArrowRight, CheckCircle2, Clock, Package, Truck } from "lucide-react";
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

/** The date string to use for "is this job today?" check. */
function jobDate(job: ActiveJob): string | null {
  if (job.for_date) return job.for_date.slice(0, 10);
  const first = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq)[0];
  if (first?.scheduled_at) return first.scheduled_at.slice(0, 10);
  if (job.planned_start_at) return job.planned_start_at.slice(0, 10);
  if (job.scheduled_at) return job.scheduled_at.slice(0, 10);
  return null;
}

/** Sort key: planned_start_at → first stop scheduled_at → scheduled_at */
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
  arrivesAt: string | null; // derived
};

type StopRow = {
  kind: "stop";
  code: string;
  name: string | null;
  stopKind: "PICKUP" | "DROP";
  plannedAt: string | null;
  arrivedAt: string | null;
  dwellMinutes: number | null; // gap until next departure
};

type SeparatorRow = {
  kind: "separator";
  label: string; // "Next job · JOB-XXXXXX"
};

type TimelineRow = LegRow | StopRow | SeparatorRow;

// ─── build timeline rows from jobs ──────────────────────────────────────────

function buildRows(
  driver: Driver,
  jobs: ActiveJob[],
): TimelineRow[] {
  const today = todayLocal();
  const todayJobs = jobs
    .filter((j) => jobDate(j) === today)
    .sort((a, b) => jobSortMs(a) - jobSortMs(b));

  if (todayJobs.length === 0) return [];

  const rows: TimelineRow[] = [];

  // Cursor: where the driver physically is at this point in the chain.
  let curLat = driver.current_lat;
  let curLon = driver.current_lon;
  let curLabel = "Current position";
  // Cursor time: derived from planned departures / arrivals.
  let curTimeIso: string | null = null;

  for (let ji = 0; ji < todayJobs.length; ji++) {
    const job = todayJobs[ji];
    const stops = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);

    if (ji > 0) {
      rows.push({ kind: "separator", label: `Next job · ${(job as { reference?: string }).reference ?? job.id.slice(0, 8).toUpperCase()}` });
    }

    for (let si = 0; si < stops.length; si++) {
      const stop = stops[si];
      const wh = stop.warehouse;

      const toLabel = wh ? `${wh.code}` : "Unknown";
      const toLat = wh?.latitude ?? null;
      const toLon = wh?.longitude ?? null;

      // ── leg from cursor → this stop ──────────────────────────────────────
      let km = 0;
      let mins = 0;
      if (curLat != null && curLon != null && toLat != null && toLon != null) {
        km = haversineKm(curLat, curLon, toLat, toLon);
        mins = etaMinutes(km);
      }

      // Departure time for this leg = curTimeIso (or planned_start_at for first stop of first job)
      let departsAt: string | null = curTimeIso;
      if (si === 0 && ji === 0) {
        departsAt = job.planned_start_at ?? curTimeIso;
      }

      // Arrival = departure + travel
      let arrivesAt: string | null = null;
      if (departsAt) {
        const depMs = new Date(departsAt).getTime();
        if (Number.isFinite(depMs)) {
          arrivesAt = new Date(depMs + mins * 60_000).toISOString();
        }
      }
      // Always prefer the planner's scheduled_at as the authoritative arrival
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

      // ── stop row ─────────────────────────────────────────────────────────
      // Dwell = gap between this stop's arrival and next departure
      // "next departure" ≈ next stop's scheduled_at (or +15 min default)
      let dwellMinutes: number | null = null;
      const nextStop = stops[si + 1] ?? todayJobs[ji + 1]?.stops?.[0];
      if (stop.scheduled_at && nextStop?.scheduled_at) {
        const diff =
          (new Date(nextStop.scheduled_at).getTime() - new Date(stop.scheduled_at).getTime()) / 60_000;
        if (diff > 0) dwellMinutes = Math.round(diff);
      }

      rows.push({
        kind: "stop",
        code: wh?.code ?? "?",
        name: null, // warehouses in ActiveStop don't carry `name`; code is enough
        stopKind: stop.kind,
        plannedAt: stop.scheduled_at,
        arrivedAt: stop.arrived_at,
        dwellMinutes,
      });

      // Advance cursor to this warehouse
      curLat = toLat;
      curLon = toLon;
      curLabel = toLabel;
      curTimeIso = stop.scheduled_at ?? arrivesAt;
    }
  }

  return rows;
}

// ─── sub-components ──────────────────────────────────────────────────────────

function LegRow({ row }: { row: LegRow }) {
  return (
    <div className="flex items-center gap-2 py-1 px-1">
      {/* connector line + truck icon */}
      <div className="flex flex-col items-center self-stretch mr-1">
        <div className="w-px flex-1 bg-border" />
        <div
          className="size-6 rounded-full flex items-center justify-center shrink-0 my-1"
          style={{ background: "oklch(0.62 0.22 245 / 0.10)", border: "1px solid oklch(0.62 0.22 245 / 0.30)" }}
        >
          <Truck className="size-3" style={{ color: "var(--primary-bright)" }} />
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>

      <div className="flex-1 min-w-0 py-1">
        {/* route line */}
        <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground flex-wrap">
          <span className="text-foreground font-medium truncate max-w-[120px]">{row.fromLabel}</span>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
          <span className="text-foreground font-medium truncate max-w-[120px]">{row.toLabel}</span>
        </div>
        {/* metrics */}
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-[11px] font-mono" style={{ color: "var(--primary-bright)" }}>
            {fmtKm(row.km)} · {row.minutes} min
          </span>
          {(row.departsAt || row.arrivesAt) && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {fmtTime(row.departsAt)}
              {row.arrivesAt && (
                <>
                  {" → "}
                  {fmtTime(row.arrivesAt)}
                </>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StopRowItem({ row }: { row: StopRow }) {
  const isPickup = row.stopKind === "PICKUP";
  const dotColor = isPickup
    ? "oklch(0.73 0.17 150 / 0.20)"
    : "oklch(0.62 0.22 245 / 0.12)";
  const dotBorder = isPickup
    ? "oklch(0.73 0.17 150 / 0.50)"
    : "oklch(0.62 0.22 245 / 0.40)";
  const kindColor = isPickup ? "var(--success-fg)" : "var(--primary-bright)";

  return (
    <div className="flex items-start gap-2 py-1 px-1">
      {/* dot */}
      <div className="flex flex-col items-center self-stretch mr-1">
        <div className="w-px flex-1 bg-border" />
        <div
          className="size-5 rounded-full flex items-center justify-center shrink-0 my-1"
          style={{ background: dotColor, border: `1px solid ${dotBorder}` }}
        >
          {row.arrivedAt ? (
            <CheckCircle2 className="size-3" style={{ color: "var(--success-fg)" }} />
          ) : (
            <MapPin className="size-3" style={{ color: kindColor }} />
          )}
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>

      <div className="flex-1 min-w-0 py-1">
        {/* warehouse + kind */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-semibold text-foreground">{row.code}</span>
          <span
            className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: dotColor, color: kindColor, border: `1px solid ${dotBorder}` }}
          >
            {isPickup ? "Pickup" : "Drop-off"}
          </span>
          {row.arrivedAt && (
            <span
              className="flex items-center gap-1 text-[10px] font-mono"
              style={{ color: "var(--success-fg)" }}
            >
              <CheckCircle2 className="size-3" />
              {fmtTime(row.arrivedAt)}
            </span>
          )}
        </div>

        {/* times */}
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {row.plannedAt && (
            <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
              <Clock className="size-3" />
              Planned {fmtTime(row.plannedAt)}
            </span>
          )}
          {row.dwellMinutes != null && row.dwellMinutes > 0 && (
            <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
              <Package className="size-3" />
              {row.dwellMinutes} min dwell
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SeparatorRow({ row }: { row: SeparatorRow }) {
  return (
    <div className="flex items-center gap-3 py-2 px-1">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground whitespace-nowrap px-1">
        {row.label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

interface DriverItineraryTimelineProps {
  driver: Driver;
  jobs: ActiveJob[];
}

export function DriverItineraryTimeline({ driver, jobs }: DriverItineraryTimelineProps) {
  const rows = buildRows(driver, jobs);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
        <Truck className="size-3.5" />
        Today's Itinerary
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground font-mono py-2">No jobs planned for today</p>
      ) : (
        <div className="flex flex-col">
          {rows.map((row, i) => {
            if (row.kind === "leg") return <LegRow key={`leg-${i}`} row={row} />;
            if (row.kind === "stop") return <StopRowItem key={`stop-${i}`} row={row} />;
            return <SeparatorRow key={`sep-${i}`} row={row} />;
          })}
        </div>
      )}
    </div>
  );
}
