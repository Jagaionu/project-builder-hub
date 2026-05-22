import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";
import { DriverStopTimeline } from "@/components/driver/DriverStopTimeline";

export const Route = createFileRoute("/d/routes/$jobId")({
  head: () => ({ meta: [{ title: "Route — Driver" }] }),
  component: JobDetail,
});

function JobDetail() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const jobs = useDriverStore((s) => s.jobs);
  const driver = useDriverStore((s) => s.driver);
  const gps = useDriverStore((s) => s.gpsPosition);
  const job = jobs.find((j) => j.id === jobId);

  if (!job) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Route not found.</p>
        <Link to="/d/routes" className="text-primary text-sm mt-2 inline-block">← Back to routes</Link>
      </div>
    );
  }

  const onArrive = async (stopId: string) => {
    const now = new Date().toISOString();
    await supabase.from("job_stops").update({ arrived_at: now } as never).eq("id", stopId);
    if (driver) await supabase.from("driver_events").insert({ driver_id: driver.id, type: "ARRIVED", payload: { stop_id: stopId } } as never);
    useDriverStore.getState().setJobs(useDriverStore.getState().jobs.map((j) =>
      j.id !== job.id ? j : { ...j, stops: j.stops.map((s) => s.id === stopId ? { ...s, arrived_at: now } : s) }
    ));
  };

  const sortedStops = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);
  const allDone = sortedStops.length > 0 && sortedStops.every((s) => s.arrived_at);

  const complete = async () => {
    await supabase.from("jobs").update({ status: "COMPLETED" } as never).eq("id", job.id);
    if (driver) await supabase.from("drivers").update({ status: "AVAILABLE" } as never).eq("id", driver.id);
    navigate({ to: "/d" });
  };

  return (
    <div className="pt-6 px-4">
      <button onClick={() => navigate({ to: "/d/routes" })} className="text-primary text-sm mb-4">← Routes</button>
      <h1 className="text-2xl font-bold text-foreground">{job.reference}</h1>
      <p className="text-sm text-muted-foreground mb-6">{sortedStops.length} stops</p>

      <DriverStopTimeline job={{ ...job, stops: sortedStops }} driverPosition={gps} onArrive={onArrive} />

      {allDone && job.status !== "COMPLETED" && (
        <button onClick={complete}
          className="mt-4 w-full bg-success text-success-foreground font-bold py-4 rounded-xl active:scale-[0.99] transition">
          Complete route
        </button>
      )}
    </div>
  );
}
