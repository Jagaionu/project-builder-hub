import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "./_app.index";
import { Clock, Check } from "lucide-react";
import { useAlerts } from "@/lib/use-alerts";

export const Route = createFileRoute("/_app/alerts")({
  component: AlertsPage,
  head: () => ({ meta: [{ title: "Alerts — Planning System" }] }),
});

function AlertsPage() {
  const { alerts, ack } = useAlerts();

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
                  <button
                    type="button"
                    onClick={() => ack(a.id)}
                    className="ml-1 inline-flex items-center gap-1 rounded-md border border-current/30 px-2 py-1 text-[11px] font-mono uppercase tracking-wider hover:bg-current/10 transition-colors"
                    title="Acknowledge and clear this alert"
                  >
                    <Check className="size-3" />
                    Ack
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
