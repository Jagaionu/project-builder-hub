import { createFileRoute } from "@tanstack/react-router";
import { useJobs, useWarehouses, useDrivers } from "@/lib/hooks";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "./_app.index";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/jobs")({
  component: JobsPage,
  head: () => ({ meta: [{ title: "Jobs — Planning System" }] }),
});

const lifecycle: { value: string; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "En route → pickup" },
  { value: "ARRIVED_PICKUP", label: "Arrived pickup" },
  { value: "EN_ROUTE_DELIVERY", label: "En route → delivery" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

function JobsPage() {
  const jobs = useJobs();
  const warehouses = useWarehouses();
  const drivers = useDrivers();

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("jobs").update({ status: status as never }).eq("id", id);
    if (error) toast.error(error.message); else toast.success(`Status → ${status}`);
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Jobs" subtitle="Complete job lifecycle and status overrides" />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Ref</th>
                <th className="px-3 py-2 text-left">Route</th>
                <th className="px-3 py-2 text-left">Driver</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">ETA</th>
                <th className="px-3 py-2 text-left">Scheduled</th>
                <th className="px-3 py-2 text-right">Advance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((j) => {
                const o = warehouses.find((w) => w.id === j.origin_warehouse_id);
                const d = warehouses.find((w) => w.id === j.destination_warehouse_id);
                const drv = drivers.find((dr) => dr.id === j.assigned_driver_id);
                return (
                  <tr key={j.id} className="hover:bg-surface-2/40">
                    <td className="px-3 py-2.5 font-mono text-xs">{j.reference}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      <span>{o?.code ?? "?"}</span>
                      <ArrowRight className="inline size-3 mx-1.5 text-muted-foreground" />
                      <span>{d?.code ?? "?"}</span>
                    </td>
                    <td className="px-3 py-2.5">{drv?.name ?? <span className="text-muted-foreground italic">unassigned</span>}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={j.status} kind="job" /></td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{j.eta_minutes ? `${j.eta_minutes}m` : "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{j.scheduled_at ? new Date(j.scheduled_at).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <select
                        value={j.status}
                        onChange={(e) => setStatus(j.id, e.target.value)}
                        className="text-xs bg-surface border border-border rounded px-1.5 py-1"
                      >
                        {lifecycle.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
