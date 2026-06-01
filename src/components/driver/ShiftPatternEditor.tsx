import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { saveShiftPattern, type ShiftPatternDay } from "@/lib/driver-shifts";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_ISO = [1, 2, 3, 4, 5, 6, 0]; // Mon=1..Sun=0
const DAY_SHORT_MAP: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 0: "Sun" };

const DEFAULT_START = "06:00";
const DEFAULT_END = "18:00";

interface ShiftPatternEditorProps {
  driverId: string;
  initialDays: number[];
  initialTimes: Record<number, { start_time: string; end_time: string }>;
  onSave: () => void;
  isPlanner?: boolean;
}

function stripSecs(t: string): string {
  return t.length > 5 ? t.slice(0, 5) : t;
}

function timesEqual(a: { start_time: string; end_time: string }, b: { start_time: string; end_time: string }) {
  return a.start_time === b.start_time && a.end_time === b.end_time;
}

function summarize(selectedDays: number[], times: Record<number, { start_time: string; end_time: string }>): string {
  if (selectedDays.length === 0) return "No working days";
  const sorted = DAY_ISO.filter((d) => selectedDays.includes(d));
  const labels = sorted.map((d) => DAY_SHORT_MAP[d]).join(", ");
  // Check if all selected days share the same start/end
  const first = times[sorted[0]];
  const allSame = first && sorted.every((d) => times[d]?.start_time === first.start_time && times[d]?.end_time === first.end_time);
  if (allSame) return `${labels} · ${first.start_time}–${first.end_time}`;
  return `${labels} · varied`;
}

export function ShiftPatternEditor({ driverId, initialDays, initialTimes, onSave, isPlanner = false }: ShiftPatternEditorProps) {
  const [selectedDays, setSelectedDays] = useState<number[]>(initialDays);
  const [times, setTimes] = useState<Record<number, { start_time: string; end_time: string }>>(
    () => {
      const t: Record<number, { start_time: string; end_time: string }> = {};
      for (const day_iso of DAY_ISO) {
        const saved = initialTimes[day_iso];
        t[day_iso] = saved
          ? { start_time: stripSecs(saved.start_time), end_time: stripSecs(saved.end_time) }
          : { start_time: DEFAULT_START, end_time: DEFAULT_END };
      }
      return t;
    },
  );
  const [saving, setSaving] = useState(false);
  // Collapsed by default in both planner and driver-app views.
  const [expanded, setExpanded] = useState(false);

  // Resync local state when parent re-fetches the pattern (e.g. after save).
  useEffect(() => {
    setSelectedDays(initialDays);
    const t: Record<number, { start_time: string; end_time: string }> = {};
    for (const day_iso of DAY_ISO) {
      const saved = initialTimes[day_iso];
      t[day_iso] = saved
        ? { start_time: stripSecs(saved.start_time), end_time: stripSecs(saved.end_time) }
        : { start_time: DEFAULT_START, end_time: DEFAULT_END };
    }
    setTimes(t);
  }, [initialDays, initialTimes]);

  const patternChanged = useMemo(() => {
    const cur = [...selectedDays].sort((a, b) => a - b).join(",");
    const init = [...initialDays].sort((a, b) => a - b).join(",");
    if (cur !== init) return true;
    for (const d of DAY_ISO) {
      if (timesEqual(times[d], initialTimes[d] ?? { start_time: DEFAULT_START + ":00", end_time: DEFAULT_END + ":00" })) continue;
      if (selectedDays.includes(d)) return true;
    }
    return false;
  }, [selectedDays, times, initialDays, initialTimes]);

  const toggleDay = (iso: number) => {
    if (!expanded) setExpanded(true);
    setSelectedDays((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso],
    );
  };

  const updateTime = (iso: number, field: "start_time" | "end_time", value: string) => {
    setTimes((prev) => ({ ...prev, [iso]: { ...prev[iso], [field]: value } }));
  };

  const discard = () => {
    setSelectedDays(initialDays);
    const reset: Record<number, { start_time: string; end_time: string }> = {};
    for (const day_iso of DAY_ISO) {
      const saved = initialTimes[day_iso];
      reset[day_iso] = saved
        ? { start_time: stripSecs(saved.start_time), end_time: stripSecs(saved.end_time) }
        : { start_time: DEFAULT_START, end_time: DEFAULT_END };
    }
    setTimes(reset);
    if (isPlanner) setExpanded(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const pattern: ShiftPatternDay[] = selectedDays.map((iso) => ({
        day_of_week: iso,
        start_time: times[iso].start_time || DEFAULT_START,
        end_time: times[iso].end_time || DEFAULT_END,
      }));
      await saveShiftPattern(supabase, driverId, pattern);
      onSave();
      toast.success("Weekly shift pattern saved");
      if (isPlanner) setExpanded(false);
    } catch (err) {
      toast.error("Couldn't save pattern", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedInOrder = DAY_ISO.filter((d) => selectedDays.includes(d));
  const showDetails = !isPlanner || expanded;

  return (
    <div className={`bg-card/50 border border-border/50 rounded-lg ${isPlanner ? "p-2 space-y-2" : "p-3 space-y-3"}`}>
      {/* Header — clickable in planner mode to expand/collapse */}
      {isPlanner ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
              Weekly Pattern
            </span>
            <span className="text-[10px] text-foreground/80 truncate">
              {summarize(selectedDays, times)}
            </span>
          </div>
          {expanded ? (
            <ChevronUp size={12} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown size={12} className="text-muted-foreground shrink-0" />
          )}
        </button>
      ) : (
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Weekly Pattern
        </p>
      )}

      {showDetails && (
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

          {/* Per-day time rows */}
          {selectedInOrder.length > 0 && (
            <div className="space-y-1.5">
              {selectedInOrder.map((iso) => {
                const dayIdx = DAY_ISO.indexOf(iso);
                const dayName = DAYS[dayIdx];
                return (
                  <div key={iso} className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-foreground w-12 shrink-0">
                      {dayName.slice(0, 3)}
                    </span>
                    <input
                      type="time"
                      step="900"
                      value={times[iso].start_time}
                      onChange={(e) => updateTime(iso, "start_time", e.target.value)}
                      className="h-7 px-2 rounded border border-border bg-surface text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-24"
                      aria-label={`${dayName} start time`}
                    />
                    <span className="text-[10px] text-muted-foreground">to</span>
                    <input
                      type="time"
                      step="900"
                      value={times[iso].end_time}
                      onChange={(e) => updateTime(iso, "end_time", e.target.value)}
                      className="h-7 px-2 rounded border border-border bg-surface text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-24"
                      aria-label={`${dayName} end time`}
                    />
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
