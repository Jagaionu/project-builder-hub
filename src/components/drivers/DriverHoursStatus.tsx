// DriverHoursStatus.tsx — Modern Dashboard Style
//
// Compact KPI dashboard showing driver hours for ad-hoc planner decisions.
// Design: large donut metric cards, stacked supporting KPI tiles.
//
// CRITICAL: compliance.daily, .weekly, .dailyHeadroom, .weeklyHeadroom are
// all in DECIMAL HOURS (e.g. 7.5 = 7h 30m), NOT minutes. Caps are also in
// hours to match the compliance module's units.

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

/** Circular progress donut (SVG). */
function DonutMetric({
  value,
  max,
  label,
  colour,
}: {
  value: number;
  max: number;
  label: string;
  colour: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full -rotate-90"
          style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))" }}
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="var(--border)"
            strokeWidth="8"
          />
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
          <div className="text-2xl font-bold text-foreground">{Math.round(pct)}</div>
          <div className="text-[9px] font-mono uppercase text-muted-foreground">%</div>
        </div>
      </div>

      <div className="mt-2 text-center">
        <div className="text-sm font-semibold text-foreground">{fmtHoursDisplay(value)}</div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

export function DriverHoursStatus({ driver, compliance }: DriverHoursStatusProps) {
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

  // Compliance values are in decimal hours (e.g. 7.5 = 7h 30m).
  const DAILY_CAP = 10;  // 10 hours
  const WEEKLY_CAP = 56; // 56 hours

  const dailyUsed = compliance.daily;
  const weeklyUsed = compliance.weekly;
  const dailyAvailable = compliance.dailyHeadroom;
  const weeklyAvailable = compliance.weeklyHeadroom;

  const isDailyBreach = dailyUsed > DAILY_CAP;
  const isWeeklyBreach = weeklyUsed > WEEKLY_CAP;
  const isDailyWarn = dailyUsed > DAILY_CAP * 0.85;
  const isWeeklyWarn = weeklyUsed > WEEKLY_CAP * 0.85;

  const dailyColour = isDailyBreach
    ? "var(--destructive)"
    : isDailyWarn
      ? "var(--warning)"
      : "var(--success)";

  const weeklyColour = isWeeklyBreach
    ? "var(--destructive)"
    : isWeeklyWarn
      ? "var(--warning)"
      : "var(--success)";

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
        <Clock className="size-3.5" />
        Driver Hours
      </div>

      {/* Two donut metric cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <DonutMetric
          value={dailyUsed}
          max={DAILY_CAP}
          label="Today (24h)"
          colour={dailyColour}
        />
        <DonutMetric
          value={weeklyUsed}
          max={WEEKLY_CAP}
          label="This Week"
          colour={weeklyColour}
        />
      </div>

      {/* Available headroom tiles */}
      <div className="grid grid-cols-2 gap-2">
        <div
          className="rounded border p-2.5"
          style={{
            borderColor: "oklch(0.73 0.17 150 / 0.30)",
            background: "oklch(0.73 0.17 150 / 0.08)",
          }}
        >
          <div
            className="text-lg font-bold"
            style={{ color: "var(--success-fg)" }}
          >
            {fmtHoursDisplay(dailyAvailable)}
          </div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
            Available Today
          </div>
        </div>
        <div
          className="rounded border p-2.5"
          style={{
            borderColor: "oklch(0.73 0.17 150 / 0.30)",
            background: "oklch(0.73 0.17 150 / 0.08)",
          }}
        >
          <div
            className="text-lg font-bold"
            style={{ color: "var(--success-fg)" }}
          >
            {fmtHoursDisplay(weeklyAvailable)}
          </div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
            Available Week
          </div>
        </div>
      </div>

      {/* Status badge + issues */}
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
              borderColor:
                compliance.status === "breach"
                  ? "var(--destructive)"
                  : "var(--warning)",
              background:
                compliance.status === "breach"
                  ? "color-mix(in oklab, var(--destructive) 10%, transparent)"
                  : "color-mix(in oklab, var(--warning) 10%, transparent)",
              color:
                compliance.status === "breach"
                  ? "var(--destructive-fg)"
                  : "var(--warning-fg)",
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
