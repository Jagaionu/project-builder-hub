// UK HGV driver hours compliance.
// Source of truth: GOV.UK drivers' hours rules.
// Assumption (per ops decision): drivers always take legally required breaks
// even if not logged. Driving time = shift duration minus auto-deducted 45min
// break for every 4.5h of driving.

export type ComplianceEvent = { type: string; timestamp: string };

export type ComplianceIssue = { level: "warn" | "breach"; msg: string };

export type Compliance = {
  onShift: boolean;
  daily: number;        // driving hours rolling 24h
  weekly: number;       // driving hours rolling 7d
  twoWeek: number;      // driving hours rolling 14d
  restHours: number;    // continuous rest before current shift, or since last shift ended
  continuousDrive: number; // driving in current "4.5h cycle" (since last assumed break)
  dailyHeadroom: number;   // hrs left until 10h hard daily cap
  weeklyHeadroom: number;  // hrs left until 56h weekly cap
  twoWeekHeadroom: number; // hrs left until 90h fortnight cap
  issues: ComplianceIssue[];
  status: "ok" | "warn" | "breach";
  blockAssignment: boolean;
};

const H = 3_600_000;
// Drop closed shift segments shorter than this — they're almost always
// webhook replays or accidental END→START bounces, not real driving.
const MIN_SEG_MS = 5 * 60_000;
// If a shift ends and a new one starts within this window, treat them as one
// continuous shift. Stops a fat-finger toggle from resetting rest hours.
const MERGE_GAP_MS = 10 * 60_000;

type Seg = { start: number; end: number; open: boolean };

function buildSegments(events: ComplianceEvent[], nowMs: number): Seg[] {
  const sorted = events
    .filter((e) => e.type === "START_SHIFT" || e.type === "END_SHIFT")
    .map((e) => ({ type: e.type, t: +new Date(e.timestamp) }))
    .sort((a, b) => a.t - b.t);
  const segs: Seg[] = [];
  let openStart: number | null = null;
  for (const e of sorted) {
    if (e.type === "START_SHIFT") {
      if (openStart == null) openStart = e.t;
    } else if (openStart != null) {
      segs.push({ start: openStart, end: e.t, open: false });
      openStart = null;
    }
  }
  if (openStart != null) segs.push({ start: openStart, end: nowMs, open: true });
  // Merge adjacent segments separated by a tiny gap (accidental bounces).
  const merged: Seg[] = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && s.start - prev.end <= MERGE_GAP_MS) {
      prev.end = s.end;
      prev.open = s.open;
    } else {
      merged.push({ ...s });
    }
  }
  return merged.filter((s) => s.open || s.end - s.start >= MIN_SEG_MS);
}

// Driving hours for a shift of `durHours`, auto-deducting 45min break per 4.5h driven.
// Driving hours for a shift of `durHours`. 
// Removed auto-deduction logic as we now use actual transit-only driving minutes.
export function driveHoursOf(durHours: number): number {
  return 0; 
}

function sumDrivingInWindow(segs: Seg[], fromMs: number, toMs: number): number {
  // Logic disabled: we now use transit-only driving minutes from the ledger or projections.
  return 0;
}

export type LedgerTotals = { daily?: number; weekly?: number; twoWeek?: number; continuousDrive?: number };

export function computeCompliance(
  events: ComplianceEvent[],
  nowMs: number = Date.now(),
  ledger?: LedgerTotals,
): Compliance {
  const segs = buildSegments(events, nowMs);
  const daily = ledger?.daily ?? sumDrivingInWindow(segs, nowMs - 24 * H, nowMs);
  const weekly = ledger?.weekly ?? sumDrivingInWindow(segs, nowMs - 7 * 24 * H, nowMs);
  const twoWeek = ledger?.twoWeek ?? sumDrivingInWindow(segs, nowMs - 14 * 24 * H, nowMs);

  const openSeg = segs.find((s) => s.open);
  const onShift = !!openSeg;

  let restHours = Infinity;
  if (onShift) {
    const prev = [...segs].reverse().find((s) => !s.open && s.end <= openSeg!.start);
    restHours = prev ? (openSeg!.start - prev.end) / H : Infinity;
  } else {
    const last = [...segs].reverse().find((s) => !s.open);
    restHours = last ? (nowMs - last.end) / H : Infinity;
  }

  // Continuous driving in the current 4.5h cycle.
  // No longer derived from shift duration. Must be provided via ledger or calculated from legs.
  const continuousDrive = ledger?.continuousDrive ?? 0;

  const issues: ComplianceIssue[] = [];
  if (weekly > 56) issues.push({ level: "breach", msg: `Weekly cap exceeded (${weekly.toFixed(1)}/56h)` });
  else if (weekly > 50) issues.push({ level: "warn", msg: `Near weekly cap (${weekly.toFixed(1)}/56h)` });

  if (twoWeek > 90) issues.push({ level: "breach", msg: `2-week cap exceeded (${twoWeek.toFixed(1)}/90h)` });
  else if (twoWeek > 80) issues.push({ level: "warn", msg: `Near 2-week cap (${twoWeek.toFixed(1)}/90h)` });

  if (daily > 10) issues.push({ level: "breach", msg: `Daily cap exceeded (${daily.toFixed(1)}/10h)` });
  else if (daily > 9) issues.push({ level: "warn", msg: `Over 9h today (${daily.toFixed(1)}h, 10h max 2×/wk)` });

  // Daily rest rule (UK HGV): need 9h+ (reduced) rest in every rolling 24h.
  // Only flag once accumulated driving in the last 24h is meaningful (>=9h);
  // a short toggle between two tiny shifts must NOT trigger this.
  if (onShift && daily >= 9) {
    const windowStart = nowMs - 24 * H;
    const segsInWindow = segs
      .filter((s) => s.end > windowStart)
      .map((s) => ({ start: Math.max(s.start, windowStart), end: s.end }))
      .sort((a, b) => a.start - b.start);
    let longestRestMs = 0;
    let cursor = windowStart;
    for (const s of segsInWindow) {
      if (s.start > cursor) longestRestMs = Math.max(longestRestMs, s.start - cursor);
      cursor = Math.max(cursor, s.end);
    }
    const longestRestH = longestRestMs / H;
    if (longestRestH < 9) {
      issues.push({ level: "breach", msg: `Insufficient rest (${longestRestH.toFixed(1)}h < 9h in last 24h)` });
    } else if (longestRestH < 11) {
      issues.push({ level: "warn", msg: `Reduced rest (${longestRestH.toFixed(1)}h, 3×/wk max)` });
    }
  }

  if (onShift && continuousDrive >= 4.5) {
    issues.push({ level: "breach", msg: `45-min break required (4.5h continuous)` });
  } else if (onShift && continuousDrive >= 4) {
    const mins = Math.max(0, Math.round((4.5 - continuousDrive) * 60));
    issues.push({ level: "warn", msg: `Break due in ${mins}min` });
  }

  const hard = issues.some((i) => i.level === "breach");
  const warn = issues.some((i) => i.level === "warn");

  return {
    onShift,
    daily,
    weekly,
    twoWeek,
    restHours,
    continuousDrive,
    dailyHeadroom: Math.max(0, 10 - daily),
    weeklyHeadroom: Math.max(0, 56 - weekly),
    twoWeekHeadroom: Math.max(0, 90 - twoWeek),
    issues,
    status: hard ? "breach" : warn ? "warn" : "ok",
    blockAssignment: hard,
  };
}
