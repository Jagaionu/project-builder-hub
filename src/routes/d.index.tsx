import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";
import { DriverJobCard } from "@/components/driver/DriverJobCard";

export const Route = createFileRoute("/d/")({
  head: () => ({ meta: [{ title: "Home — Driver" }] }),
  component: DriverHome,
});

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available", ON_SHIFT: "On Shift", ON_ROUTE: "On Route", OFF_SHIFT: "Off Shift", DELAYED: "Delayed",
};
const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: "text-success", ON_SHIFT: "text-primary", ON_ROUTE: "text-success",
  OFF_SHIFT: "text-muted-foreground", DELAYED: "text-warning",
};

function DriverHome() {
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);
  const jobs = useDriverStore((s) => s.jobs);
  const isOnline = useDriverStore((s) => s.isOnline);
  const gps = useDriverStore((s) => s.gpsPosition);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [availTomorrow, setAvailTomorrow] = useState(driver?.available_tomorrow ?? false);

  if (!driver) {
    return <div className="p-6 text-center text-muted-foreground">Loading driver…</div>;
  }

  const isOnShift = driver.status !== "OFF_SHIFT";
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t.toISOString().slice(0, 10); })();
  const todayJobs = jobs.filter((j) => j.for_date === today);
  const tomorrowJobs = jobs.filter((j) => j.for_date === tomorrow);
  const activeJobs = todayJobs.filter((j) => !["COMPLETED", "CANCELLED"].includes(j.status));
  const STATUS_ORDER = ["ARRIVED_PICKUP", "EN_ROUTE_DELIVERY", "IN_PROGRESS", "ASSIGNED", "PENDING"];
  const nextJob = [...activeJobs].sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.status);
    const sb = STATUS_ORDER.indexOf(b.status);
    if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
    const ta = a.planned_start_at ?? a.scheduled_at ?? "";
    const tb = b.planned_start_at ?? b.scheduled_at ?? "";
    return ta.localeCompare(tb);
  })[0];

  const toggleShift = async () => {
    setShiftLoading(true);
    try {
      const newStatus = isOnShift ? "OFF_SHIFT" : "AVAILABLE";
      await supabase.from("drivers").update({ status: newStatus, last_update_time: new Date().toISOString() } as never).eq("id", driver.id);
      await supabase.from("driver_events").insert({ driver_id: driver.id, type: isOnShift ? "END_SHIFT" : "START_SHIFT" } as never);
      setDriver({ ...driver, status: newStatus });
    } finally { setShiftLoading(false); }
  };

  const toggleAvail = async () => {
    const next = !availTomorrow;
    setAvailTomorrow(next);
    await supabase.from("drivers").update({ available_tomorrow: next } as never).eq("id", driver.id);
    setDriver({ ...driver, available_tomorrow: next });
  };

  return (
    <div className="pt-6">
      <header className="px-4 pb-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">Welcome back</p>
          <h1 className="text-2xl font-bold text-foreground mt-0.5">{driver.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-success" : "bg-destructive"}`} />
          <span className={`text-xs font-semibold ${STATUS_COLOR[driver.status]}`}>{STATUS_LABEL[driver.status]}</span>
        </div>
      </header>

      <div className="mx-4 mb-4 bg-card border border-border rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Location sharing</p>
          <p className="text-xs text-muted-foreground">
            {gps ? `Live · ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}` : "Waiting for GPS permission…"}
          </p>
        </div>
        <span className={`w-2.5 h-2.5 rounded-full ${gps ? "bg-success" : "bg-warning"}`} />
      </div>

      <div className="mx-4 mb-4 bg-card border border-border rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">{isOnShift ? "Shift active" : "Shift not started"}</p>
          <p className="text-xs text-muted-foreground">{isOnShift ? "Tap to end your shift" : "Tap to clock in"}</p>
        </div>
        <button onClick={toggleShift} disabled={shiftLoading}
          className={`px-5 py-2.5 rounded-xl text-sm font-bold transition active:scale-95 ${isOnShift ? "bg-destructive/20 text-destructive border border-destructive/40" : "bg-success/20 text-success border border-success/40"}`}>
          {shiftLoading ? "…" : isOnShift ? "End shift" : "Start shift"}
        </button>
      </div>

      <section className="px-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Today</h2>
          <span className="text-xs text-muted-foreground">{activeJobs.length} active</span>
        </div>
        {todayJobs.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-6 text-center">
            <p className="text-sm text-muted-foreground">No jobs assigned today.</p>
          </div>
        ) : (
          <div className="space-y-3">{todayJobs.map((j) => <DriverJobCard key={j.id} job={j} />)}</div>
        )}
      </section>

      <section className="mx-4 mb-6 bg-card border border-border rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Available tomorrow?</p>
            <p className="text-xs text-muted-foreground">Let dispatch know if you're free</p>
          </div>
          <button onClick={toggleAvail}
            className={`relative w-12 h-7 rounded-full transition ${availTomorrow ? "bg-success" : "bg-muted"}`}>
            <span className={`absolute top-0.5 ${availTomorrow ? "right-0.5" : "left-0.5"} w-6 h-6 bg-card rounded-full transition-all border border-border`} />
          </button>
        </div>
        {tomorrowJobs.length > 0 && (
          <div className="mt-3 space-y-3">{tomorrowJobs.map((j) => <DriverJobCard key={j.id} job={j} showTomorrow />)}</div>
        )}
      </section>
    </div>
  );
}
