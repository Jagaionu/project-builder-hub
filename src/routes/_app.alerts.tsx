import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "./_app.index";
import { Clock, Check, AlertTriangle, Info, Zap } from "lucide-react";
import { useAlerts } from "@/lib/use-alerts";

export const Route = createFileRoute("/_app/alerts")({
  component: AlertsPage,
  head: () => ({ meta: [{ title: "Alerts — Planning System" }] }),
});

const LEVEL_CONFIG = {
  critical: {
    bg:     "oklch(0.63 0.22 20 / 0.08)",
    border: "oklch(0.63 0.22 20 / 0.35)",
    text:   "oklch(0.72 0.18 20)",
    bar:    "oklch(0.63 0.22 20)",
    Icon:   Zap,
  },
  warning: {
    bg:     "oklch(0.80 0.18 72 / 0.08)",
    border: "oklch(0.80 0.18 72 / 0.35)",
    text:   "oklch(0.80 0.16 72)",
    bar:    "oklch(0.80 0.18 72)",
    Icon:   AlertTriangle,
  },
  info: {
    bg:     "oklch(0.68 0.16 230 / 0.08)",
    border: "oklch(0.68 0.16 230 / 0.30)",
    text:   "oklch(0.73 0.13 230)",
    bar:    "oklch(0.68 0.16 230)",
    Icon:   Info,
  },
} as const;

// Safe helper to inject alpha transparencies dynamically inside valid OKLCH syntax
const getAlphaColor = (oklchString: string, alpha: number) => {
  return oklchString.replace(")", ` / ${alpha})`);
};

function AlertsPage() {
  const { alerts, ack } = useAlerts();

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Alerts"
        subtitle={alerts.length === 0 ? "All clear — no active alerts" : `${alerts.length} active alert${alerts.length !== 1 ? "s" : ""}`}
      />

      <div className="flex-1 overflow-y-auto p-5">
        {alerts.length === 0 ? (
          <div
            className="rounded-xl border p-10 text-center page-enter"
            style={{
              background: "oklch(0.73 0.17 150 / 0.05)",
              borderColor: "oklch(0.73 0.17 150 / 0.20)",
            }}
          >
            <div
              className="size-12 rounded-full grid place-items-center mx-auto mb-4"
              style={{ background: "oklch(0.73 0.17 150 / 0.12)" }}
            >
              <Check className="size-6" style={{ color: "oklch(0.78 0.14 150)" }} />
            </div>
            <div
              className="text-sm font-semibold font-mono uppercase tracking-widest"
              style={{ color: "oklch(0.78 0.14 150)" }}
            >
              All clear
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              No operational alerts at this time.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5 page-enter">
            {alerts.map((a, i) => {
              const cfg = LEVEL_CONFIG[a.level];
              const { Icon } = cfg;
              return (
                <li
                  key={a.id}
                  className="fade-up rounded-xl border overflow-hidden flex"
                  style={{
                    animationDelay: `${i * 50}ms`,
                    background: cfg.bg,
                    borderColor: cfg.border,
                  }}
                >
                  {/* Left accent bar */}
                  <div className="w-1 shrink-0" style={{ background: cfg.bar }} />

                  <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
                    <div
                      className="size-8 rounded-lg grid place-items-center shrink-0"
                      style={{ background: getAlphaColor(cfg.bar, 0.15) }}
                    >
                      <Icon className="size-4" style={{ color: cfg.text }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[10px] font-mono uppercase tracking-widest mb-0.5"
                        style={{ color: cfg.text, opacity: 0.75 }}
                      >
                        {a.type}
                      </div>
                      <div className="text-sm flex items-center gap-2 flex-wrap" style={{ color: cfg.text }}>
                        <span>{a.message}</span>
                        {/* Clickable job reference link → Dispatch tab with job pre-selected */}
                        {a.jobRef && (
                          <Link
                            to="/dispatch"
                            search={{ job: a.jobRef }}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold border transition-all hover:opacity-90 shrink-0"
                            style={{
                              borderColor: cfg.border,
                              color: cfg.text,
                              background: getAlphaColor(cfg.bar, 0.12),
                            }}
                            title={`Open ${a.jobRef} in Dispatch`}
                          >
                            {a.jobRef} →
                          </Link>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                        <Clock className="size-3" />
                        <span>now</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => ack(a.id)}
                        title="Acknowledge and clear"
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider transition-all"
                        style={{
                          borderColor: cfg.border,
                          color: cfg.text,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = getAlphaColor(cfg.bar, 0.12))}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <Check className="size-3" />
                        Ack
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
