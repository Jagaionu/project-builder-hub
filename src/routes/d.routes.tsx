import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useDriverStore } from "@/lib/driver-store";
import { DriverJobCard } from "@/components/driver/DriverJobCard";

export const Route = createFileRoute("/d/routes")({
  head: () => ({ meta: [{ title: "Routes — Driver" }] }),
  component: RoutesLayout,
});

function RoutesLayout() {
  const location = useLocation();
  // If a child like /d/routes/$jobId is matched, just render it.
  if (location.pathname !== "/d/routes") return <Outlet />;
  return <RoutesIndex />;
}

function RoutesIndex() {
  const jobs = useDriverStore((s) => s.jobs);
  const active = jobs.filter((j) => !["COMPLETED", "CANCELLED"].includes(j.status));
  const done = jobs.filter((j) => j.status === "COMPLETED");

  return (
    <div className="pt-6 px-4">
      <h1 className="text-2xl font-bold mb-4 text-foreground">Routes</h1>

      <section className="mb-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Active ({active.length})</h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-4">No active routes.</p>
        ) : (
          <div className="space-y-3">{active.map((j) => <DriverJobCard key={j.id} job={j} />)}</div>
        )}
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Completed ({done.length})</h2>
        {done.length === 0 ? (
          <p className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-4">Nothing completed yet.</p>
        ) : (
          <div className="space-y-3">{done.map((j) => <DriverJobCard key={j.id} job={j} />)}</div>
        )}
      </section>
    </div>
  );
}
