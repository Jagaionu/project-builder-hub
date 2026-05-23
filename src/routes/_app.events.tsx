import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight,
  Play, Square, MapPin, CheckCircle2, AlertTriangle,
  Send, Ban, XCircle, Activity,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDrivers, useJobs } from "@/lib/hooks";
import { PageHeader } from "./_app.index";
import type { DriverEvent, Job } from "@/lib/types";

export const Route = createFileRoute("/_app/events")({
  component: EventLog,
  head: () => ({ meta: [{ title: "Event Log — Planning System" }] }),
});

const EVENT_CONFIG: Record<string, {
  color: string;
  bg: string;
  Icon: React.ElementType;
}> = {
  START_SHIFT:        { color: "oklch(0.73 0.17 150)", bg: "oklch(0.73 0.17 150 / 0.10)", Icon: Play },
  END_SHIFT:          { color: "oklch(0.52 0.012 245)",bg: "oklch(0.22 0.018 245)",        Icon: Square },
  END_SHIFT_BLOCKED:  { color: "oklch(0.80 0.16 72)",  bg: "oklch(0.80 0.18 72  / 0.10)", Icon: Ban },
  LOCATION_UPDATE:    { color: "oklch(0.45 0.012 245)",bg: "oklch(0.20 0.018 245)",        Icon: MapPin },
  ACCEPT_JOB:         { color: "oklch(0.73 0.17 150)", bg: "oklch(0.73 0.17 150 / 0.10)", Icon: CheckCircle2 },
  JOB_CARD_SENT:      { color: "oklch(0.62 0.22 245)", bg: "oklch(0.62 0.22 245 / 0.10)", Icon: Send },
  DELAY_REPORT:       { color: "oklch(0.80 0.16 72)",  bg: "oklch(0.80 0.18 72  / 0.10)", Icon: AlertTriangle },
  CANT_COMPLETE:      { color: "oklch(0.63 0.22 20)",  bg: "oklch(0.63 0.22 20  / 0.10)", Icon: XCircle },
};

function EventLog() {
  const drivers = useDrivers();
  const jobs    = useJobs();
  const [events, setEvents]       = useState<DriverEvent[]>([]);
  const [openDrivers, setOpenDrivers] = useState<Set<string>>(new Set());
  const [showRaw, setShowRaw]     = useState(false);

  useEffect(() => {
    supabase.from("driver_events").select("*")
      .order("timestamp", { ascending: false }).limit(500)
      .then(({ data }) => { if (data) setEvents(data as DriverEvent[]); });
    const ch = supabase.channel("rt-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "driver_events" },
        (payload) => setEvents((prev) => [payload.new as DriverEvent, ...prev].slice(0, 500)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const jobsById = useMemo(() => {
    const m: Record<string, Job> = {};
    for (const j of jobs) m[j.id] = j;
    return m;
  }, [jobs]);

  const grouped = useMemo(() => {
    const map = new Map<string, DriverEvent[]>();
    for (const e of events) {
      if (!map.has(e.driver_id)) map.set(e.driver_id, []);
      map.get(e.driver_id)!.push(e);
    }
    return Array.from(map.entries())
      .map(([driverId, evs]) => ({ driverId, events: evs }))
      .sort((a, b) => +new Date(b.events[0].timestamp) - +new Date(a.events[0].timestamp));
  }, [events]);

  const toggle = (id: string) =>
    setOpenDrivers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Event Log"
        subtitle={`${grouped.length} drivers · ${events.length} events`}
        right={
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            <input
              type="checkbox" checked={showRaw}
              onChange={(e) => setShowRaw(e.target.checked)}
              className="size-3 accent-primary"
            />
            Raw payload
          </label>
        }
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-2">
        {grouped.length === 0 ? (
          <div
            className="rounded-xl border px-4 py-10 text-center"
            style={{ background: "oklch(0.17 0.018 245)", borderColor: "oklch(0.24 0.018 245)" }}
          >
            <Activity className="size-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No events yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Driver actions in the app will populate this stream.
            </p>
          </div>
        ) : (
          grouped.map(({ driverId, events: evs }) => {
            const drv     = drivers.find((d) => d.id === driverId);
            const isOpen  = openDrivers.has(driverId);
            const latest  = evs[0];
            const todayCount = evs.filter(
              (e) => new Date(e.timestamp).toDateString() === new Date().toDateString(),
            ).length;
            const latestCfg = EVENT_CONFIG[latest.type];

            return (
              <div
                key={driverId}
                className="rounded-xl overflow-hidden transition-all"
                style={{
                  background: "oklch(0.17 0.018 245)",
                  border: `1px solid ${isOpen ? "oklch(0.28 0.020 245)" : "oklch(0.22 0.018 245)"}`,
                  boxShadow: isOpen ? "0 4px 16px oklch(0 0 0 / 0.25)" : "none",
                }}
              >
                {/* Driver header row */}
                <button
                  type="button"
                  onClick={() => toggle(driverId)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left transition-colors"
                  style={{ background: isOpen ? "oklch(0.20 0.020 245)" : "transparent" }}
                >
                  {isOpen
                    ? <ChevronDown  className="size-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}

                  {/* Avatar */}
                  <div
                    className="size-7 rounded-lg grid place-items-center text-xs font-bold font-mono shrink-0"
                    style={{
                      background: "oklch(0.62 0.22 245 / 0.12)",
                      color: "oklch(0.75 0.18 245)",
                      border: "1px solid oklch(0.62 0.22 245 / 0.25)",
                    }}
                  >
                    {(drv?.name ?? "?")[0]?.toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {drv?.name ?? driverId.slice(0, 8)}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {todayCount} today · {evs.length} total
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground truncate">
                      {latestCfg && (
                        <latestCfg.Icon
                          className="size-3 shrink-0"
                          style={{ color: latestCfg.color }}
                        />
                      )}
                      <span className="truncate">{summarize(latest, jobsById)}</span>
                      <span className="opacity-50 shrink-0">· {relTime(latest.timestamp)}</span>
                    </div>
                  </div>
                </button>

                {/* Events timeline */}
                {isOpen && (
                  <ul
                    className="divide-y"
                    style={{ borderTop: "1px solid oklch(0.22 0.018 245)", borderColor: "oklch(0.22 0.018 245)" }}
                  >
                    {evs.map((e) => {
                      const cfg = EVENT_CONFIG[e.type];
                      const Icon = cfg?.Icon ?? Activity;
                      return (
                        <li
                          key={e.id}
                          className="px-4 py-2.5 flex items-start gap-3 transition-colors"
                          style={{ borderColor: "oklch(0.20 0.016 245)" }}
                          onMouseEnter={el => (el.currentTarget.style.background = "oklch(0.20 0.018 245)")}
                          onMouseLeave={el => (el.currentTarget.style.background = "transparent")}
                        >
                          {/* Time */}
                          <span className="text-[10px] font-mono text-muted-foreground/60 w-12 shrink-0 pt-0.5 tabular-nums">
                            {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>

                          {/* Icon */}
                          <div
                            className="size-5 rounded-md grid place-items-center shrink-0 mt-0.5"
                            style={{ background: cfg?.bg ?? "oklch(0.20 0.018 245)" }}
                          >
                            <Icon className="size-3" style={{ color: cfg?.color ?? "oklch(0.52 0.012 245)" }} />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 text-xs">
                            <div className="text-foreground/90">{summarize(e, jobsById)}</div>
                            {showRaw && Object.keys(e.payload ?? {}).length > 0 && (
                              <pre className="mt-1.5 text-[10px] font-mono text-muted-foreground/60 whitespace-pre-wrap break-all bg-background/40 rounded px-2 py-1">
                                {JSON.stringify(e.payload, null, 2)}
                              </pre>
                            )}
                          </div>

                          {/* Relative time */}
                          <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">
                            {relTime(e.timestamp)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function summarize(e: DriverEvent, jobsById: Record<string, Job>): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const jobRef = (() => {
    const id = p.job_id as string | undefined;
    if (!id) return null;
    return jobsById[id]?.reference ?? id.slice(0, 8);
  })();
  switch (e.type) {
    case "START_SHIFT":       return "Started shift";
    case "END_SHIFT":         return p.had_active_route ? "Ended shift (had active route)" : "Ended shift";
    case "END_SHIFT_BLOCKED": return "Tried to end shift — blocked (active route)";
    case "LOCATION_UPDATE": {
      const lat = typeof p.lat === "number" ? p.lat.toFixed(4) : "?";
      const lon = typeof p.lon === "number" ? p.lon.toFixed(4) : "?";
      return `Location update (${lat}, ${lon})`;
    }
    case "ACCEPT_JOB":       return jobRef ? `Accepted job ${jobRef}` : "Accepted job";
    case "JOB_CARD_SENT":    return jobRef ? `Job card sent for ${jobRef}` : "Job card sent";
    case "DELAY_REPORT": {
      const reason = (p.reason as string) || "Delay reported";
      return jobRef ? `${reason} (job ${jobRef})` : reason;
    }
    case "CANT_COMPLETE":    return jobRef ? `Can't complete job ${jobRef}` : "Can't complete";
    default:                 return e.type.replace(/_/g, " ").toLowerCase();
  }
}

function relTime(ts: string): string {
  const diff = Date.now() - +new Date(ts);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
