import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, History, PlayCircle } from "lucide-react";
import { DriverJobCard } from "@/components/driver/DriverJobCard";
import { useDriverStore } from "@/lib/driver-store";

export const Route = createFileRoute("/d/routes")({
  head: () => ({ meta: [{ title: "Routes — Driver" }] }),
  component: DriverRoutesPage,
});

function DriverRoutesPage() {
  const jobs = useDriverStore((s) => s.jobs);
  const activeJobs = jobs.filter((j) => !["COMPLETED", "CANCELLED"].includes(j.status));
  const completedJobs = jobs.filter((j) => j.status === "COMPLETED");

  return (
    <div
      className="pt-safe min-h-screen page-enter px-4 pb-8"
      style={{ paddingTop: "env(safe-area-inset-top, 0)" }}
    >
      <div className="pt-6 pb-5">
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          Driver App
        </p>
        <h1 className="text-2xl font-bold mt-0.5 tracking-tight">Routes</h1>
      </div>

      <div className="space-y-6">
        <section>
          <div className="flex items-center gap-2 mb-3">
            <PlayCircle className="size-4 text-primary" />
            <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Active Routes ({activeJobs.length})
            </h2>
          </div>

          {activeJobs.length === 0 ? (
            <div
              className="rounded-2xl p-6 text-center"
              style={{
                background: "oklch(0.17 0.018 245)",
                border: "1px solid oklch(0.24 0.018 245)",
              }}
            >
              <p className="text-sm font-medium text-foreground">No active routes</p>
              <p className="text-xs text-muted-foreground mt-1">Check back with dispatch</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeJobs.map((job) => (
                <DriverJobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </section>

        {completedJobs.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <History className="size-4 text-muted-foreground" />
              <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Completed ({completedJobs.length})
              </h2>
            </div>
            <div className="space-y-3">
              {completedJobs.map((job) => (
                <Link
                  key={job.id}
                  to="/d/routes/$jobId"
                  params={{ jobId: job.id }}
                  className="block relative"
                >
                  <DriverJobCard job={job} />
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
