import type { DriverStatus, JobStatus } from "@/lib/types";

const driverMap: Record<DriverStatus, string> = {
  AVAILABLE: "bg-success/15 text-success border-success/30",
  ON_SHIFT: "bg-info/15 text-info border-info/30",
  ON_ROUTE: "bg-primary/15 text-primary border-primary/30",
  DELAYED: "bg-destructive/15 text-destructive border-destructive/30",
  OFF_SHIFT: "bg-muted text-muted-foreground border-border",
};

const jobMap: Record<JobStatus, string> = {
  PENDING: "bg-warning/15 text-warning border-warning/30",
  ASSIGNED: "bg-info/15 text-info border-info/30",
  IN_PROGRESS: "bg-primary/15 text-primary border-primary/30",
  ARRIVED_PICKUP: "bg-accent/15 text-accent border-accent/30",
  EN_ROUTE_DELIVERY: "bg-primary/15 text-primary border-primary/30",
  COMPLETED: "bg-success/15 text-success border-success/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, kind }: { status: string; kind: "driver" | "job" }) {
  const cls = kind === "driver" ? driverMap[status as DriverStatus] : jobMap[status as JobStatus];
  return (
    <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${cls ?? ""}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {status.replace(/_/g, " ")}
    </span>
  );
}
