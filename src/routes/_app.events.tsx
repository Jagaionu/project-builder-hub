import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Send,
  Ban,
  XCircle,
  Activity,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDrivers, useJobs } from "@/lib/hooks";
import { PageHeader } from "./_app.index";
import type { DriverEvent, Job } from "@/lib/types";

export const Route = createFileRoute("/_app/events")({
  component: EventLog,
  head: () => ({ meta: [{ title: "Event Log — Planning System" }] }),
});

function EventLog() {
  const drivers = useDrivers();
  const jobs = useJobs();
  const [events, setEvents] = useState<DriverEvent[]>([]);
  const [openDrivers, setOpenDrivers] = useState<Set<string>>(new Set());
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    supabase
      .from("driver_events")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (data) setEvents(data as DriverEvent[]);
      });
    const ch = supabase
      .channel("rt-events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "driver_events" },
        (payload) => setEvents((prev) => [payload.new as DriverEvent, ...prev].slice(0, 500)),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const jobsById = useMemo(() => {
    const m: Record<string, Job> = {};
    for (const j of jobs) m[j.id] = j;
    return m;
  }, [jobs]);

  // Group by driver, ordered by most recent activity.
  const grouped = useMemo(() => {
    const map = new Map<string, DriverEvent[]>();
    for (const e of events) {
      if (!map.has(e.driver_id)) map.set(e.driver_id, []);
      map.get(e.driver_id)!.push(e);
    }
    return Array.from(map.entries())
      .map(([driverId, evs]) => ({ driverId, events: evs }))
      .sort(
        (a, b) =>
          +new Date(b.events[0].timestamp) - +new Date(a.events[0].timestamp),
      );
  }, [events]);

  const toggle = (id: string) =>
    setOpenDrivers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Event Log" subtitle="Driver activity grouped by person — expand to dive in" />
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {grouped.length} driver{grouped.length === 1 ? "" : "s"} · {events.length} events
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={(e) => setShowRaw(e.target.checked)}
              className="size-3"
            />
            Show raw payload
          </label>
        </div>

        {grouped.length === 0 ? (
          <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No events yet. The Telegram webhook will populate this stream.
          </div>
        ) : (
          grouped.map(({ driverId, events: evs }) => {
            const drv = drivers.find((d) => d.id === driverId);
            const isOpen = openDrivers.has(driverId);
            const latest = evs[0];
            const todayCount = evs.filter(
              (e) =>
                new Date(e.timestamp).toDateString() === new Date().toDateString(),
            ).length;
            return (
              <div
                key={driverId}
                className="rounded-md border border-border bg-card overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(driverId)}
                  className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-surface-2/40 transition-colors text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="size-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                    {(drv?.name ?? "?")[0]?.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {drv?.name ?? driverId.slice(0, 8)}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {todayCount} today · {evs.length} total
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                      <EventIcon type={latest.type} />
                      <span>{summarize(latest, jobsById)}</span>
                      <span className="opacity-60">· {relTime(latest.timestamp)}</span>
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <ul className="border-t border-border divide-y divide-border/50">
                    {evs.map((e) => (
                      <li
                        key={e.id}
                        className="px-3 py-2 flex items-start gap-3 hover:bg-surface-2/30"
                      >
                        <span className="text-[10px] font-mono text-muted-foreground w-16 shrink-0 pt-0.5">
                          {new Date(e.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <EventIcon type={e.type} />
                        <div className="flex-1 min-w-0 text-xs">
                          <div>{summarize(e, jobsById)}</div>
                          {showRaw && Object.keys(e.payload ?? {}).length > 0 && (
                            <pre className="mt-1 text-[10px] font-mono text-muted-foreground/70 whitespace-pre-wrap break-all">
                              {JSON.stringify(e.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">
                          {relTime(e.timestamp)}
                        </span>
                      </li>
                    ))}
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

function EventIcon({ type }: { type: string }) {
  const cls = "size-3.5 shrink-0";
  switch (type) {
    case "START_SHIFT":
      return <Play className={`${cls} text-success`} />;
    case "END_SHIFT":
      return <Square className={`${cls} text-muted-foreground`} />;
    case "END_SHIFT_BLOCKED":
      return <Ban className={`${cls} text-warning`} />;
    case "LOCATION_UPDATE":
      return <MapPin className={`${cls} text-muted-foreground/70`} />;
    case "ACCEPT_JOB":
      return <CheckCircle2 className={`${cls} text-success`} />;
    case "JOB_CARD_SENT":
      return <Send className={`${cls} text-primary`} />;
    case "DELAY_REPORT":
      return <AlertTriangle className={`${cls} text-warning`} />;
    case "CANT_COMPLETE":
      return <XCircle className={`${cls} text-destructive`} />;
    default:
      return <Activity className={`${cls} text-muted-foreground`} />;
  }
}

function summarize(e: DriverEvent, jobsById: Record<string, Job>): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const jobRef = (() => {
    const id = p.job_id as string | undefined;
    if (!id) return null;
    return jobsById[id]?.reference ?? id.slice(0, 8);
  })();
  switch (e.type) {
    case "START_SHIFT":
      return "Started shift";
    case "END_SHIFT":
      return p.had_active_route
        ? "Ended shift (still had an active route)"
        : "Ended shift";
    case "END_SHIFT_BLOCKED":
      return "Tried to end shift — blocked (active route)";
    case "LOCATION_UPDATE": {
      const lat = typeof p.lat === "number" ? p.lat.toFixed(4) : "?";
      const lon = typeof p.lon === "number" ? p.lon.toFixed(4) : "?";
      return `Location update (${lat}, ${lon})`;
    }
    case "ACCEPT_JOB":
      return jobRef ? `Accepted job ${jobRef}` : "Accepted job";
    case "JOB_CARD_SENT":
      return jobRef ? `Job card sent for ${jobRef}` : "Job card sent";
    case "DELAY_REPORT": {
      const reason = (p.reason as string) || "Delay reported";
      return jobRef ? `${reason} (job ${jobRef})` : reason;
    }
    case "CANT_COMPLETE":
      return jobRef
        ? `Reported can't complete job ${jobRef}`
        : "Reported can't complete";
    default:
      return e.type.replace(/_/g, " ").toLowerCase();
  }
}

function relTime(ts: string): string {
  const diff = Date.now() - +new Date(ts);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
