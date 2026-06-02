// DriverHoursStatus.tsx — three hour-rings (Today / Week / Fortnight).
//
// Each ring shows DRIVEN hours in the centre and remaining headroom below, so a
// dispatcher can tell at a glance whether a driver can take an extra collection.
// Values are DECIMAL HOURS and read the same drive_minutes the planner enforces.

import { Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Driver } from "@/lib/types";
import type { Compliance } from "@/lib/compliance";

interface DriverHoursStatusProps {
  driver: Driver;
  compliance: Compliance | null;
}

/** Format decimal hours → readable string. e.g. 7.75 → "7h 45m" */
function fmtHoursDisplay(hours: number): string {
  if (hours <= 0) return "0m";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const colourFor = (used: number, cap: number): string =>
  used > cap ? "var(--destructive)" : used > cap * 0.85 ? "var(--warning)" : "var(--success)";

/** Circular progress donut (SVG) — driven hours in the centre. */
function DonutMetric({
  value,
  max,
  label,
  colour,
  remaining,
}: {
  value: number;
  max: number;
  label: string;
  colour: string;
  remaining: number;
}) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full aspect-square max-w-[7rem]">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full -rotate-90"
          style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))" }}
        >
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border)" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke={colour}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.4s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-base font-bold text-foreground leading-none">{fmtHoursDisplay(value)}</div>
          <div className="text-[8px] font-mono uppercase text-muted-foreground mt-0.5">of {max}h</div>
        </div>
      </div>
      <div className="mt-2 text-center">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-[10px] font-semibold" style={{ color: colour }}>
          {fmtHoursDisplay(remaining)} left
        </div>
      </div>
    </div>
  );
}

export function DriverHoursStatus({ compliance }: DriverHoursStatusProps) {
  if (!compliance) {
    return (
      <div className="rounded border border-border bg-surface p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <Clock className="size-3.5" />
          Driver Hours
        </div>
        <p className="text-xs text-muted-foreground font-mono">Loading…</p>
      </div>
    );
  }

  const DAILY_CAP = 10;
  const WEEKLY_CAP = 56;
  const FORTNIGHT_CAP = 90;

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
        <Clock className="size-3.5" />
        Driver Hours
      </div>

      <div className="grid grid-cols-3 gap-2">
        <DonutMetric
          value={compliance.daily}
          max={DAILY_CAP}
          remaining={compliance.dailyHeadroom}
          label="Today (24h)"
          colour={colourFor(compliance.daily, DAILY_CAP)}
        />
        <DonutMetric
          value={compliance.weekly}
          max={WEEKLY_CAP}
          remaining={compliance.weeklyHeadroom}
          label="This Week"
          colour={colourFor(compliance.weekly, WEEKLY_CAP)}
        />
        <DonutMetric
          value={compliance.twoWeek}
          max={FORTNIGHT_CAP}
          remaining={compliance.twoWeekHeadroom}
          label="Fortnight (14d)"
          colour={colourFor(compliance.twoWeek, FORTNIGHT_CAP)}
        />
      </div>

      <div className="mt-3 pt-3 border-t border-border">
        {compliance.status === "ok" && compliance.issues.length === 0 ? (
          <div
            className="rounded border p-2 flex items-center gap-2 text-[10px] font-mono"
            style={{
              borderColor: "oklch(0.73 0.17 150 / 0.30)",
              background: "oklch(0.73 0.17 150 / 0.10)",
              color: "var(--success-fg)",
            }}
          >
            <CheckCircle2 className="size-3.5 shrink-0" />
            <span>Compliant</span>
          </div>
        ) : compliance.issues.length > 0 ? (
          <div
            className="rounded border p-2 space-y-0.5"
            style={{
              borderColor: compliance.status === "breach" ? "var(--destructive)" : "var(--warning)",
              background:
                compliance.status === "breach"
                  ? "color-mix(in oklab, var(--destructive) 10%, transparent)"
                  : "color-mix(in oklab, var(--warning) 10%, transparent)",
              color: compliance.status === "breach" ? "var(--destructive-fg)" : "var(--warning-fg)",
            }}
          >
            {compliance.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[9px] font-mono">
                <AlertCircle className="size-3 mt-0.5 shrink-0" />
                <span>{issue.msg}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
