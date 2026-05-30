import type { DriverStatus, JobStatus } from "@/lib/types";

// All colours come from the design system CSS variables so they
// automatically respect any theme changes in styles.css.
const driverMap: Record<DriverStatus | "SCHEDULED", { bg: string; text: string; border: string }> =
  {
    AVAILABLE: {
      bg: "oklch(0.73 0.17 150 / 0.10)",
      text: "var(--success-fg)",
      border: "oklch(0.73 0.17 150 / 0.30)",
    },
    ON_SHIFT: {
      bg: "oklch(0.68 0.16 230 / 0.10)",
      text: "var(--info-fg)",
      border: "oklch(0.68 0.16 230 / 0.30)",
    },
    ON_ROUTE: {
      bg: "oklch(0.62 0.22 245 / 0.12)",
      text: "var(--primary-bright)",
      border: "oklch(0.62 0.22 245 / 0.30)",
    },
    DELAYED: {
      bg: "color-mix(in oklab, var(--destructive) 10%, transparent)",
      text: "var(--destructive-fg)",
      border: "color-mix(in oklab, var(--destructive) 30%, transparent)",
    },
    OFF_SHIFT: {
      bg: "var(--secondary)",
      text: "var(--muted-foreground)",
      border: "var(--border)",
    },
    SCHEDULED: {
      bg: "oklch(0.62 0.22 245 / 0.08)",
      text: "var(--info)",
      border: "oklch(0.68 0.16 230 / 0.25)",
    },
  };

const jobMap: Record<JobStatus | "SCHEDULED", { bg: string; text: string; border: string }> = {
  PENDING: {
    bg: "color-mix(in oklab, var(--warning) 10%, transparent)",
    text: "var(--warning-fg)",
    border: "color-mix(in oklab, var(--warning) 30%, transparent)",
  },
  ASSIGNED: {
    bg: "oklch(0.68 0.16 230 / 0.10)",
    text: "var(--info-fg)",
    border: "oklch(0.68 0.16 230 / 0.30)",
  },
  IN_PROGRESS: {
    bg: "oklch(0.62 0.22 245 / 0.12)",
    text: "var(--primary-bright)",
    border: "oklch(0.62 0.22 245 / 0.30)",
  },
  ARRIVED_PICKUP: {
    bg: "oklch(0.62 0.22 245 / 0.12)",
    text: "var(--primary-bright)",
    border: "oklch(0.62 0.22 245 / 0.30)",
  },
  EN_ROUTE_DELIVERY: {
    bg: "oklch(0.62 0.22 245 / 0.12)",
    text: "var(--primary-bright)",
    border: "oklch(0.62 0.22 245 / 0.30)",
  },
  COMPLETED: {
    bg: "oklch(0.73 0.17 150 / 0.10)",
    text: "var(--success-fg)",
    border: "oklch(0.73 0.17 150 / 0.30)",
  },
  CANCELLED: {
    bg: "color-mix(in oklab, var(--destructive) 10%, transparent)",
    text: "var(--destructive-fg)",
    border: "color-mix(in oklab, var(--destructive) 30%, transparent)",
  },
  SCHEDULED: {
    bg: "oklch(0.62 0.22 245 / 0.08)",
    text: "var(--info)",
    border: "oklch(0.68 0.16 230 / 0.25)",
  },
};

export function StatusBadge({ status, kind }: { status: string; kind: "driver" | "job" }) {
  const map = kind === "driver" ? driverMap : jobMap;
  const cfg = map[status as keyof typeof map];

  if (!cfg) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider bg-muted text-muted-foreground border-border">
        <span className="size-1.5 rounded-full bg-current" />
        {status.replace(/_/g, " ")}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider"
      style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border }}
    >
      <span className="size-1.5 rounded-full shrink-0" style={{ background: cfg.text }} />
      {status.replace(/_/g, " ")}
    </span>
  );
}
