import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useDrivers, useJobs, useWarehouses } from "@/lib/hooks";
import { StatusBadge } from "@/components/StatusBadge";
import { haversineKm, etaMinutes } from "@/lib/geo";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PageHeader } from "./_app.index";
import { Sparkles, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_app/dispatch")({
  component: DispatchPanel,
  head: () => ({ meta: [{ title: "Dispatch — Planning System" }] }),
});

function DispatchPanel() {
  const drivers = useDrivers();
  const jobs = useJobs();
  const warehouses = useWarehouses();
  const [selectedJob, setSelectedJob] = useState<string | null>(null);

  const pending = jobs.filter((j) => j.status === "PENDING");
  const job = jobs.find((j) => j.id === selectedJob) ?? pending[0] ?? null;
  const origin = job ? warehouses.find((w) => w.id === job.origin_warehouse_id) : null;
  const dest = job ? warehouses.find((w) => w.id === job.destination_warehouse_id) : null;

  const ranked = useMemo(() => {
    if (!origin) return [];
    return drivers
      .filter((d) => d.status === "AVAILABLE" || d.status === "ON_SHIFT")
      .filter((d) => d.current_lat != null && d.current_lon != null)
      .map((d) => {
        const distKm = haversineKm(d.current_lat!, d.current_lon!, origin.latitude, origin.longitude);
        return { driver: d, distKm, eta: etaMinutes(distKm) };
      })
      .sort((a, b) => a.distKm - b.distKm);
  }, [drivers, origin]);

  async function assign(driverId: string) {
    if (!job) return;
    const dist = ranked.find((r) => r.driver.id === driverId);
    const { error } = await supabase
      .from("jobs")
      .update({ assigned_driver_id: driverId, status: "ASSIGNED", eta_minutes: dist?.eta ?? null })
      .eq("id", job.id);
    if (error) toast.error(error.message);
    else toast.success(`Assigned ${dist?.driver.name} to ${job.reference}`);
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Dispatch" subtitle={`${pending.length} pending job${pending.length === 1 ? "" : "s"} awaiting assignment`} />
      <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr]">
        {/* Pending queue */}
        <div className="border-r border-border overflow-y-auto bg-surface">
          <div className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border">
            Pending Queue
          </div>
          {pending.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No pending jobs.</div>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((j) => {
                const o = warehouses.find((w) => w.id === j.origin_warehouse_id);
                const d = warehouses.find((w) => w.id === j.destination_warehouse_id);
                return (
                  <li key={j.id}>
                    <button
                      onClick={() => setSelectedJob(j.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-surface-2 transition ${job?.id === j.id ? "bg-surface-2 border-l-2 border-primary" : ""}`}
                    >
                      <div className="font-mono text-xs text-muted-foreground">{j.reference}</div>
                      <div className="mt-1 flex items-center gap-2 text-sm font-mono">
                        <span>{o?.code}</span>
                        <ArrowRight className="size-3 text-muted-foreground" />
                        <span>{d?.code}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {j.scheduled_at ? new Date(j.scheduled_at).toLocaleString() : "ASAP"}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Assignment panel */}
        <div className="overflow-y-auto">
          {!job ? (
            <div className="h-full grid place-items-center text-muted-foreground text-sm">Select a job to dispatch</div>
          ) : (
            <div className="p-6 max-w-3xl">
              <div className="flex items-center gap-3">
                <div className="font-mono text-xs text-muted-foreground">{job.reference}</div>
                <StatusBadge status={job.status} kind="job" />
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight flex items-center gap-3 font-mono">
                {origin?.code} <ArrowRight className="size-4 text-muted-foreground" /> {dest?.code}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">{origin?.name} → {dest?.name}</p>

              <div className="mt-6 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <Sparkles className="size-3.5 text-accent" />
                Suggested drivers (closest first)
              </div>

              <div className="mt-3 rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Driver</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Distance</th>
                      <th className="px-3 py-2 text-right">ETA</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ranked.slice(0, 8).map(({ driver, distKm, eta }, i) => (
                      <tr key={driver.id} className={i === 0 ? "bg-primary/5" : ""}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            {i === 0 && <span className="text-[9px] font-mono text-primary border border-primary/40 rounded px-1">BEST</span>}
                            <span>{driver.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge status={driver.status} kind="driver" /></td>
                        <td className="px-3 py-2.5 text-right font-mono">{distKm.toFixed(1)} km</td>
                        <td className="px-3 py-2.5 text-right font-mono">{eta} min</td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => assign(driver.id)}
                            className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                          >
                            Assign
                          </button>
                        </td>
                      </tr>
                    ))}
                    {ranked.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No available drivers with known location.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
