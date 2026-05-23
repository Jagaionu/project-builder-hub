import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { useDrivers, useJobs, useWarehouses } from "@/lib/hooks";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientOnly } from "@/components/ClientOnly";
import { haversineKm, etaMinutes } from "@/lib/geo";
import { Truck, Navigation, Clock } from "lucide-react";
import { useActiveJobsByDriver } from "@/lib/use-driver-routes";
import { effectiveDriverStatus, effectiveJobStatus, isJobScheduledFuture } from "@/lib/effective-status";

const LiveMap = lazy(() => import("@/components/LiveMap").then((m) => ({ default: m.LiveMap })));

export const Route = createFileRoute("/_app/")({
  component: LiveDashboard,
  head: () => ({
    meta: [
      { title: "Live Map — Planning System" },
      { name: "description", content: "Real-time driver tracking across UK Amazon warehouses." },
    ],
  }),
});

function LiveDashboard() {
  const drivers = useDrivers();
  const warehouses = useWarehouses();
  const jobs = useJobs();
  const activeJobsByDriver = useActiveJobsByDriver();
  const [selected, setSelected] = useState<string | null>(null);

  const selectedDriver = drivers.find((d) => d.id === selected) ?? null;
  const selectedDriverActiveJobs = selected ? activeJobsByDriver[selected] ?? [] : [];
  const selectedJob = useMemo(
    () => jobs.find((j) => j.assigned_driver_id === selected && ["ASSIGNED","IN_PROGRESS","ARRIVED_PICKUP","EN_ROUTE_DELIVERY"].includes(j.status)),
    [jobs, selected]
  );
  const destWh = selectedJob
    ? warehouses.find((w) =>
        selectedJob.status === "ASSIGNED" || selectedJob.status === "IN_PROGRESS"
          ? w.id === selectedJob.origin_warehouse_id
          : w.id === selectedJob.destination_warehouse_id
      )
    : null;

  const distKm = selectedDriver && destWh && selectedDriver.current_lat && selectedDriver.current_lon
    ? haversineKm(selectedDriver.current_lat, selectedDriver.current_lon, destWh.latitude, destWh.longitude)
    : null;

  const nowMs = Date.now();
  const stats = {
    active: drivers.filter((d) => {
      const eff = effectiveDriverStatus(d.status, activeJobsByDriver[d.id] ?? [], nowMs);
      return eff === "ON_ROUTE" || eff === "ON_SHIFT";
    }).length,
    available: drivers.filter((d) => d.status === "AVAILABLE").length,
    delayed: drivers.filter((d) => d.status === "DELAYED").length,
    pending: jobs.filter((j) => j.status === "PENDING").length,
    availableTomorrow: drivers.filter(
      (d) => (d as { available_tomorrow?: boolean }).available_tomorrow === true,
    ).length,
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Live Operations" subtitle="Real-time driver and fleet visibility across UK network" />

      <div className="grid grid-cols-5 gap-3 px-5 py-3 border-b border-border bg-surface/40">
        <Stat label="ACTIVE DRIVERS" value={stats.active} accent="primary" />
        <Stat label="AVAILABLE" value={stats.available} accent="success" />
        <Stat label="DELAYED" value={stats.delayed} accent="destructive" />
        <Stat label="PENDING JOBS" value={stats.pending} accent="warning" />
        <Stat label="AVAIL. TOMORROW" value={stats.availableTomorrow} accent="primary" />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_320px]">
        <div className="relative scanline">
          <ClientOnly fallback={<div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">Loading map…</div>}>
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">Loading map…</div>}>
              <LiveMap
                drivers={drivers}
                warehouses={warehouses}
                jobs={jobs}
                selectedDriverId={selected}
                onSelectDriver={setSelected}
              />
            </Suspense>
          </ClientOnly>
        </div>

        <aside className="border-l border-border bg-surface overflow-y-auto">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Fleet</div>
            <div className="text-sm font-semibold mt-0.5">{drivers.length} drivers</div>
          </div>

          {selectedDriver && (
            <div className="p-4 border-b border-border bg-surface-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-muted-foreground font-mono">SELECTED</div>
                  <div className="text-sm font-semibold mt-0.5">{selectedDriver.name}</div>
                </div>
                <StatusBadge status={selectedDriver.status} kind="driver" />
              </div>
              {selectedJob && destWh && (
                <div className="mt-3 space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Active Job</div>
                  <div className="font-mono text-xs">{selectedJob.reference}</div>
                  <div className="flex items-center gap-2 text-sm">
                    <Navigation className="size-3.5 text-primary" />
                    <span className="font-mono">→ {destWh.code}</span>
                  </div>
                  {distKm != null && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded border border-border bg-surface p-2">
                        <div className="text-[10px] text-muted-foreground font-mono">DIST</div>
                        <div className="font-mono text-sm mt-0.5">{distKm.toFixed(1)} km</div>
                      </div>
                      <div className="rounded border border-border bg-surface p-2">
                        <div className="text-[10px] text-muted-foreground font-mono">ETA</div>
                        <div className="font-mono text-sm mt-0.5">{etaMinutes(distKm)} min</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {selectedDriver.last_update_time && (
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                  <Clock className="size-3" /> last ping {new Date(selectedDriver.last_update_time).toLocaleTimeString()}
                </div>
              )}
            </div>
          )}

          <ul className="divide-y divide-border">
            {drivers.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => setSelected(d.id)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-surface-2 transition-colors ${selected === d.id ? "bg-surface-2" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Truck className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{d.name}</span>
                    </div>
                    <StatusBadge status={d.status} kind="driver" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: "primary" | "success" | "destructive" | "warning" }) {
  const colorMap = {
    primary: "text-primary",
    success: "text-success",
    destructive: "text-destructive",
    warning: "text-warning",
  };
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-2xl font-mono font-semibold mt-0.5 ${colorMap[accent]}`}>{value}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <header className="px-5 py-3 border-b border-border flex items-center justify-between">
      <div>
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}
