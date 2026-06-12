import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { saveShiftPattern, type ShiftPatternDay } from "@/lib/driver-shifts";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_ISO = [1, 2, 3, 4, 5, 6, 0]; // Mon=1..Sun=0
const DAY_SHORT_MAP: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  0: "Sun",
};

const DEFAULT_START = "06:00";
const DEFAULT_END = "18:00";

// Per-day time window in local editor state. null = "no fixed hours" (the
// driver is available that day with no shift-end cap — compliance only).
type TimeState = { start_time: string; end_time: string } | null;

interface ShiftPatternEditorProps {
  driverId: string;
  initialDays: number[];
  initialTimes: Record<number, { start_time: string | null; end_time: string | null }>;
  onSave: () => void;
  isPlanner?: boolean;
}

function stripSecs(t: string): string {
  return t.length > 5 ? t.slice(0, 5) : t;
}

// Map a stored entry to editor state: only treat it as a fixed window when
// BOTH ends are present; otherwise it's "no fixed hours".
function toState(
  saved: { start_time: string | null; end_time: string | null } | undefined,
): TimeState {
  if (saved && saved.start_time && saved.end_time) {
    return { start_time: stripSecs(saved.start_time), end_time: stripSecs(saved.end_time) };
  }
  return null;
}

function sameTime(a: TimeState, b: TimeState): boolean {
  if (a === null || b === null) return a === b;
  return a.start_time === b.start_time && a.end_time === b.end_time;
}

function buildTimes(
  initialTimes: Record<number, { start_time: string | null; end_time: string | null }>,
): Record<number, TimeState> {
  const t: Record<number, TimeState> = {};
  for (const iso of DAY_ISO) t[iso] = toState(initialTimes[iso]);
  return t;
}

function summarize(selectedDays: number[], times: Record<number, TimeState>): string {
  if (selectedDays.length === 0) return "No working days";
  const sorted = DAY_ISO.filter((d) => selectedDays.includes(d));
  const labels = sorted.map((d) => DAY_SHORT_MAP[d]).join(", ");
  const first = times[sorted[0]];
  const allSame = !!first && sorted.every((d) => sameTime(times[d], first));
  if (allSame && first) return `${labels} · ${first.start_time}–${first.end_time}`;
  const anyTimed = sorted.some((d) => times[d] !== null);
  return anyTimed ? `${labels} · varied` : `${labels} · any time`;
}

export function ShiftPatternEditor({
  driverId,
  initialDays,
  initialTimes,
  onSave,
  isPlanner = false,
}: ShiftPatternEditorProps) {
  const [selectedDays, setSelectedDays] = useState<number[]>(initialDays);
  const [times, setTimes] = useState<Record<number, TimeState>>(() => buildTimes(initialTimes));
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Resync local state when parent re-fetches the pattern (e.g. after save).
  useEffect(() => {
    setSelectedDays(initialDays);
    setTimes(buildTimes(initialTimes));
  }, [initialDays, initialTimes]);

  const patternChanged = useMemo(() => {
    const cur = [...selectedDays].sort((a, b) => a - b).join(",");
    const init = [...initialDays].sort((a, b) => a - b).join(",");
    if (cur !== init) return true;
    for (const d of selectedDays) {
      if (!sameTime(times[d], toState(initialTimes[d]))) return true;
    }
    return false;
  }, [selectedDays, times, initialDays, initialTimes]);

  const toggleDay = (iso: number) => {
    if (!expanded) setExpanded(true);
    setSelectedDays((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso],
    );
  };

  // Switch a day between "no fixed hours" (null) and a default time window.
  const toggleHours = (iso: number) => {
    setTimes((prev) => ({
      ...prev,
      [iso]: prev[iso] ? null : { start_time: DEFAULT_START, end_time: DEFAULT_END },
    }));
  };

  const updateTime = (iso: number, field: "start_time" | "end_time", value: string) => {
    setTimes((prev) => {
      const cur = prev[iso] ?? { start_time: DEFAULT_START, end_time: DEFAULT_END };
      return { ...prev, [iso]: { ...cur, [field]: value } };
    });
  };

  const discard = () => {
    setSelectedDays(initialDays);
    setTimes(buildTimes(initialTimes));
    setExpanded(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Days are compulsory; times are optional (null = no fixed hours).
      const pattern: ShiftPatternDay[] = selectedDays.map((iso) => {
        const t = times[iso];
        return {
          day_of_week: iso,
          start_time: t ? t.start_time : null,
          end_time: t ? t.end_time : null,
        };
      });
      await saveShiftPattern(supabase, driverId, pattern);
      onSave();
      toast.success("Weekly shift pattern saved");
      setExpanded(false);
    } catch (err) {
      toast.error("Couldn't save pattern", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedInOrder = DAY_ISO.filter((d) => selectedDays.includes(d));

  return (
    <div
      className={`bg-card/50 border border-border/50 rounded-lg ${isPlanner ? "p-2 space-y-2" : "p-3 space-y-3"}`}
    >
      {/* Header — always clickable to expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`${isPlanner ? "text-[10px]" : "text-xs"} font-bold uppercase tracking-wider text-muted-foreground shrink-0`}
          >
            Weekly Pattern
          </span>
          <span className={`${isPlanner ? "text-[10px]" : "text-xs"} text-foreground/80 truncate`}>
            {summarize(selectedDays, times)}
          </span>
        </div>
        {expanded ? (
          <ChevronUp size={isPlanner ? 12 : 14} className="text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown size={isPlanner ? 12 : 14} className="text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <>
          {/* Day toggle row */}
          <div className="flex gap-1">
            {DAYS.map((day, i) => {
              const iso = DAY_ISO[i];
              const active = selectedDays.includes(iso);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(iso)}
                  className={
                    "flex-1 py-1.5 rounded-md text-[10px] font-bold transition active:scale-95 " +
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
                    (active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/30 text-muted-foreground hover:bg-muted/50")
                  }
                >
                  {day.slice(0, 2)}
                </button>
              );
            })}
          </div>

          {/* Per-day time rows — hours are OPTIONAL */}
          {selectedInOrder.length > 0 && (
            <div className="space-y-1.5">
              {selectedInOrder.map((iso) => {
                const dayIdx = DAY_ISO.indexOf(iso);
                const dayName = DAYS[dayIdx];
                const t = times[iso];
                return (
                  <div key={iso} className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-foreground w-12 shrink-0">
                      {dayName.slice(0, 3)}
                    </span>
                    {t === null ? (
                      <>
                        <span className="text-[11px] text-muted-foreground flex-1">
                          Any time (no fixed hours)
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleHours(iso)}
                          className="inline-flex items-center gap-1 px-2 h-7 rounded border border-border text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition active:scale-95"
                        >
                          <Clock size={11} /> Set hours
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          type="time"
                          step="900"
                          value={t.start_time}
                          onChange={(e) => updateTime(iso, "start_time", e.target.value)}
                          className="h-7 px-2 rounded border border-border bg-surface text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-24"
                          aria-label={`${dayName} start time`}
                        />
                        <span className="text-[10px] text-muted-foreground">to</span>
                        <input
                          type="time"
                          step="900"
                          value={t.end_time}
                          onChange={(e) => updateTime(iso, "end_time", e.target.value)}
                          className="h-7 px-2 rounded border border-border bg-surface text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-24"
                          aria-label={`${dayName} end time`}
                        />
                        <button
                          type="button"
                          onClick={() => toggleHours(iso)}
                          title="Clear hours (any time)"
                          aria-label={`${dayName} clear hours`}
                          className="inline-flex items-center justify-center h-7 w-7 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition active:scale-95"
                        >
                          <X size={12} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Save / Discard */}
          {patternChanged && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={discard}
                disabled={saving}
                className="flex-1 py-1 rounded-md text-[10px] font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition active:scale-95 disabled:opacity-60"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex-1 py-1 rounded-md text-[10px] font-semibold bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-60"
              >
                {saving ? "…" : "Save"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
