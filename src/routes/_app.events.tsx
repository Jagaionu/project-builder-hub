import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDrivers } from "@/lib/hooks";
import { PageHeader } from "./_app.index";
import type { DriverEvent } from "@/lib/types";

export const Route = createFileRoute("/_app/events")({
  component: EventLog,
  head: () => ({ meta: [{ title: "Event Log — Planning System" }] }),
});

function EventLog() {
  const drivers = useDrivers();
  const [events, setEvents] = useState<DriverEvent[]>([]);

  useEffect(() => {
    supabase.from("driver_events").select("*").order("timestamp", { ascending: false }).limit(200).then(({ data }) => {
      if (data) setEvents(data as DriverEvent[]);
    });
    const ch = supabase.channel("rt-events").on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "driver_events" },
      (payload) => setEvents((prev) => [payload.new as DriverEvent, ...prev].slice(0, 200))
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Event Log" subtitle="Raw driver events from Telegram bot webhook" />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="rounded-md border border-border overflow-hidden font-mono text-xs">
          <div className="bg-surface px-3 py-2 grid grid-cols-[140px_140px_140px_1fr] gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            <div>Time</div><div>Driver</div><div>Type</div><div>Payload</div>
          </div>
          <ul className="divide-y divide-border">
            {events.length === 0 ? (
              <li className="px-3 py-6 text-center text-muted-foreground">No events yet. Telegram webhook will populate this stream.</li>
            ) : events.map((e) => {
              const drv = drivers.find((d) => d.id === e.driver_id);
              return (
                <li key={e.id} className="px-3 py-2 grid grid-cols-[140px_140px_140px_1fr] gap-3 hover:bg-surface-2/40">
                  <span className="text-muted-foreground">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className="truncate">{drv?.name ?? e.driver_id.slice(0, 8)}</span>
                  <span className="text-primary">{e.type}</span>
                  <span className="text-muted-foreground truncate">{JSON.stringify(e.payload)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
