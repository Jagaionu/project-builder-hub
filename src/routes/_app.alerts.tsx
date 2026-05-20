import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDrivers, useJobs, useCompliance } from "@/lib/hooks";
import { PageHeader } from "./_app.index";
import { AlertTriangle, Clock, WifiOff, Timer, Gauge } from "lucide-react";

export const Route = createFileRoute("/_app/alerts")({
  component: AlertsPage,
  head: () => ({ meta: [{ title: "Alerts — Planning System" }] }),
});

interface Alert {
  id: string;
  level: "critical" | "warning" | "info";
  type: string;
  message: string;
  icon: typeof AlertTriangle;
  time?: string;
}

function AlertsPage() {
  const drivers = useDrivers();
  const jobs = useJobs();
  const compliance = useCompliance();

  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];
    const now = Date.now();

    drivers.forEach((d) => {
      if (d.status === "DELAYED") {
        out.push({ id: `d-${d.id}`, level: "critical", type: "Delay reported", icon: AlertTriangle, message: `${d.name} flagged DELAYED` });
      }
      if (d.last_update_time) {
        const ageMin = (now - new Date(d.last_update_time).getTime()) / 60000;
        if (ageMin > 15 && d.status !== "OFF_SHIFT") {
          out.push({ id: `s-${d.id}`, level: "warning", type: "Stale location", icon: WifiOff, message: `${d.name} no ping for ${Math.round(ageMin)} min` });
        }
      }
    });

    jobs.forEach((j) => {
      if ((j.status === "ASSIGNED" || j.status === "IN_PROGRESS") && j.eta_minutes && j.scheduled_at) {
        const overdueMin = (now - new Date(j.scheduled_at).getTime()) / 60000 - j.eta_minutes;
        if (overdueMin > 0) {
          out.push({ id: `j-${j.id}`, level: "warning", type: "Overdue ETA", icon: Timer, message: `${j.reference} overdue by ${Math.round(overdueMin)} min` });
        }
      }
    });
    return out;
  }, [drivers, jobs]);

  const colors = {
    critical: "border-destructive/40 bg-destructive/10 text-destructive",
    warning: "border-warning/40 bg-warning/10 text-warning",
    info: "border-info/40 bg-info/10 text-info",
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Alerts" subtitle="Live operational anomalies" />
      <div className="flex-1 overflow-y-auto p-5">
        {alerts.length === 0 ? (
          <div className="rounded-md border border-border bg-surface p-8 text-center">
            <div className="text-success text-sm font-mono">ALL CLEAR</div>
            <p className="text-xs text-muted-foreground mt-1">No active alerts.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => {
              const Icon = a.icon;
              return (
                <li key={a.id} className={`rounded-md border px-3 py-2.5 flex items-center gap-3 ${colors[a.level]}`}>
                  <Icon className="size-4 shrink-0" />
                  <div className="flex-1">
                    <div className="text-[10px] font-mono uppercase tracking-widest opacity-80">{a.type}</div>
                    <div className="text-sm">{a.message}</div>
                  </div>
                  <Clock className="size-3.5 opacity-60" />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
