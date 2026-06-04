import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useDrivers, useJobs, useWarehouses } from "@/lib/hooks";
import { useJobStops } from "@/lib/dispatch/use-job-stops";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientOnly } from "@/components/ClientOnly";
import { haversineKm, etaMinutes } from "@/lib/geo";
import { ArrowLeft, Navigation, Clock, Radio, X } from "lucide-react";
import { useActiveJobsByDriver } from "@/lib/use-driver-routes";
import { useDriverPositions } from "@/lib/use-driver-positions";
import { useDriverSchedule } from "@/lib/use-driver-schedule";
import { effectiveDriverStatus } from "@/lib/effective-status";

const LiveMap = lazy(() => import("@/components/LiveMap").then((m) => ({ default: m.LiveMap })));

const indexSearchSchema = z.object({
  focusJob: z.string().optional(),
});

export const Route = createFileRoute("/_app/")({
  component: LiveDashboard,
  validateSearch: indexSearchSchema,
  head: () => ({
    meta: [
      { title: "Live Map — Planning System" },
      { name: "description", content: "Real-time driver tracking across UK network." },
    ],
  }),
});

function LiveDashboard() {
  const drivers            = useDrivers();
  const warehouses         = useWarehouses();
  const jobs               = useJobs();
  const stopsMap           = useJobStops();
  const activeJobsByDriver = useActiveJobsByDriver();
  const schedule = useDriverSchedule(drivers.map((d) => d.id));
  const { focusJob: focusJobId } = Route.useSearch();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const nowMs = Date.now();

  // Resolve focused job + driver (drives the filter + auto-selection).
  const focusedJob = useMemo(
    () => (focusJobId ? jobs.find((j) => j.id === focusJobId) ?? null : null),
    [jobs, focusJobId],
  );
  const focusedDriverId = focusedJob
    ? focusedJob.assigned_driver_id ?? focusedJob.planned_driver_id ?? null
    : null;

  // When entering focus mode, auto-select the assigned driver.
  useEffect(() => {
    if (focusedDriverId) setSelected(focusedDriverId);
  }, [focusedDriverId]);

  // Build the set of warehouse ids relevant to the focused job (all stops,
  // falling back to origin+destination on the job row).
  const focusWhIds = useMemo(() => {
    if (!focusedJob) return null;
    const ids = new Set<string>();
    const stops = stopsMap[focusedJob.id] ?? [];
    for (const s of stops) ids.add(s.warehouse_id);
    if (ids.size === 0) {
      if (focusedJob.origin_warehouse_id) ids.add(focusedJob.origin_warehouse_id);
      if (focusedJob.destination_warehouse_id) ids.add(focusedJob.destination_warehouse_id);
    }
    return ids;
  }, [focusedJob, stopsMap]);

  // Filtered data passed to the map when focus is active.
  const mapDrivers = useMemo(
    () =>
      focusedDriverId
        ? drivers.filter((d) => d.id === focusedDriverId)
        : drivers.filter(
            (d) =>
              schedule[d.id] !== "not_scheduled" ||
              (activeJobsByDriver[d.id]?.length ?? 0) > 0,
          ),
    [drivers, focusedDriverId, schedule, activeJobsByDriver],
  );
  const mapWarehouses = useMemo(
    () => (focusWhIds ? warehouses.filter((w) => focusWhIds.has(w.id)) : warehouses),
    [warehouses, focusWhIds],
  );
  const mapJobs = useMemo(
    () => (focusedJob ? [focusedJob] : jobs),
    [jobs, focusedJob],
  );

  const selectedDriver = drivers.find((d) => d.id === selected) ?? null;
  const selectedDriverActiveJobs = selected ? activeJobsByDriver[selected] ?? [] : [];
  // GPS breadcrumb trail for the selected driver — refetched whenever a new
  // ping lands (last_update_time bumps via the drivers realtime stream).
  const breadcrumbs = useDriverPositions(selected, selectedDriver?.last_update_time ?? null);
  const selectedJob = useMemo(
    () => jobs.find((j) => j.assigned_driver_id === selected &&
      ["ASSIGNED","IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"].includes(j.status)),
    [jobs, selected],
  );
  const destWh = selectedJob
    ? warehouses.find((w) =>
        selectedJob.status === "ASSIGNED" || selectedJob.status === "IN_PROGRESS"
          ? w.id === selectedJob.origin_warehouse_id
          : w.id === selectedJob.destination_warehouse_id,
      )
    : null;
  const distKm = selectedDriver && destWh && selectedDriver.current_lat && selectedDriver.current_lon
    ? haversineKm(selectedDriver.current_lat, selectedDriver.current_lon, destWh.latitude, destWh.longitude)
    : null;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title={focusedJob ? `Focused · ${focusedJob.reference}` : "Live Operations"}
        subtitle={focusedJob ? "Showing only this VRID's driver and stops" : "Real-time fleet visibility"}
        right={
          focusedJob ? (
            <div className="flex items-center gap-2">
              <Link
                to="/dispatch"
                search={{ job: focusedJob.reference } as never}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/15"
              >
                <ArrowLeft className="size-3" /> Back to VRID
              </Link>
              <button
                onClick={() => navigate({ to: "/", search: {} as never })}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs hover:bg-surface-2"
                title="Clear focus"
              >
                <X className="size-3" /> Clear
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
              <Radio className="size-3 text-success" />
              <span>Live</span>
              <span className="size-1.5 rounded-full bg-success animate-pulse" />
            </div>
          )
        }
      />

      {/* Map + sidebar — takes up all remaining space, no KPI strip */}
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_300px]">
        {/* Map */}
        <div className="relative scanline">
          <ClientOnly fallback={<MapPlaceholder />}>
            <Suspense fallback={<MapPlaceholder />}>
              <LiveMap
                drivers={mapDrivers}
                warehouses={mapWarehouses}
                jobs={mapJobs}
                jobStops={stopsMap}
                breadcrumbs={breadcrumbs}
                selectedDriverId={selected}
                onSelectDriver={setSelected}
              />
            </Suspense>
          </ClientOnly>
        </div>


        {/* Fleet panel */}
        <aside
          className="flex flex-col overflow-hidden"
          style={{ borderLeft: "1px solid var(--secondary)" }}
        >
          {/* Panel header */}
          <div
            className="px-4 py-3 shrink-0"
            style={{ borderBottom: "1px solid var(--sidebar-divider)" }}
          >
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Fleet</div>
            <div className="text-sm font-semibold mt-0.5">{drivers.length} drivers</div>
          </div>

          {/* Selected driver detail */}
          {selectedDriver && (
            <div
              className="p-4 shrink-0"
              style={{
                background: "var(--surface)",
                borderBottom: "1px solid var(--secondary)",
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-0.5">
                    Selected driver
                  </div>
                  <div className="text-sm font-semibold">{selectedDriver.name}</div>
                </div>
                <StatusBadge
                  status={effectiveDriverStatus(selectedDriver.status, selectedDriverActiveJobs, nowMs)}
                  kind="driver"
                />
              </div>

              {selectedJob && destWh && (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Active job
                  </div>
                  <div
                    className="rounded-lg px-3 py-2 space-y-2"
                    style={{
                      background: "var(--input)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div className="font-mono text-xs text-foreground">{selectedJob.reference}</div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <Navigation className="size-3 text-primary" />
                      <span className="font-mono text-muted-foreground">→ {destWh.code}</span>
                      <span className="text-muted-foreground/60 truncate">{destWh.name}</span>
                    </div>
                    {distKm != null && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <MetricPill label="Dist" value={`${distKm.toFixed(1)} km`} />
                        <MetricPill label="ETA"  value={`${etaMinutes(distKm)} min`} />
                      </div>
                    )}
                    {selectedDriver.current_lat != null && selectedDriver.current_lon != null && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <MetricPill label="Lat" value={selectedDriver.current_lat.toFixed(6)} />
                        <MetricPill label="Lon" value={selectedDriver.current_lon.toFixed(6)} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedDriver.last_update_time && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono mt-2.5">
                  <Clock className="size-3" />
                  {new Date(selectedDriver.last_update_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono mt-1.5">
                <Radio className="size-3" />
                {breadcrumbs.length} GPS ping{breadcrumbs.length === 1 ? "" : "s"} · 24h
              </div>
            </div>
          )}

          {/* Driver list */}
          <ul className="flex-1 overflow-y-auto divide-y" style={{ borderColor: "var(--sidebar-divider)" }}>
            {drivers.map((d) => {
              const eff = effectiveDriverStatus(d.status, activeJobsByDriver[d.id] ?? [], nowMs, schedule[d.id] ?? "unknown");
              const isSelected = selected === d.id;
              return (
                <li key={d.id}>
                  <button
                    onClick={() => setSelected(isSelected ? null : d.id)}
                    className="w-full text-left px-4 py-2.5 transition-colors"
                    style={{
                      background: isSelected ? "oklch(0.62 0.22 245 / 0.08)" : "transparent",
                      borderLeft: isSelected ? "2px solid var(--primary)" : "2px solid transparent",
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--surface)"; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="size-6 rounded-md grid place-items-center text-[10px] font-mono font-bold shrink-0"
                          style={{
                            background: isSelected ? "oklch(0.62 0.22 245 / 0.15)" : "var(--secondary)",
                            color: isSelected ? "var(--primary-bright)" : "var(--muted-foreground)",
                            border: `1px solid ${isSelected ? "oklch(0.62 0.22 245 / 0.3)" : "var(--border)"}`,
                          }}
                        >
                          {d.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm truncate">{d.name}</span>
                      </div>
                      <StatusBadge status={eff} kind="driver" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function MapPlaceholder() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <span className="text-sm text-muted-foreground">Loading map…</span>
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md px-2 py-1.5"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono text-xs mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header
      className="px-5 py-3 flex items-center justify-between shrink-0"
      style={{ borderBottom: "1px solid var(--sidebar-divider)" }}
    >
      <div>
        <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      {right}
    </header>
  );
}
