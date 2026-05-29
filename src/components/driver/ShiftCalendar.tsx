import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchShiftDays, saveShiftDays } from "@/lib/driver-shifts";
import type { DriverAvailabilityOverride } from "@/lib/types";

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_ISO = [1, 2, 3, 4, 5, 6, 0];
const INSTRUCTIONS =
  "Select your regular working days. Tap a working day to mark it off. Tap any grey day to add it as an extra working day.";

interface ShiftCalendarProps {
  driverId: string;
  isPlanner?: boolean;
}

type DayType = "working" | "holiday" | "extra" | "off";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function localDateString(year: number, monthIndex: number, day: number) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function todayLocalDateString() {
  const now = new Date();
  return localDateString(now.getFullYear(), now.getMonth(), now.getDate());
}

export function ShiftCalendar({ driverId, isPlanner = false }: ShiftCalendarProps) {
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [savedDays, setSavedDays] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<DriverAvailabilityOverride[]>([]);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const loaded = await fetchShiftDays(supabase, driverId);
      if (cancelled) return;
      setSelectedDays(loaded);
      setSavedDays(loaded);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const start = localDateString(year, month, 1);
      const end = localDateString(year, month, new Date(year, month + 1, 0).getDate());
      const { data } = await supabase
        .from("driver_availability_overrides")
        .select("*")
        .eq("driver_id", driverId)
        .gte("date", start)
        .lte("date", end);

      if (!cancelled) setOverrides((data ?? []) as DriverAvailabilityOverride[]);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [driverId, currentMonth]);

  const patternChanged = useMemo(() => {
    const current = [...selectedDays].sort((a, b) => a - b).join(",");
    const saved = [...savedDays].sort((a, b) => a - b).join(",");
    return current !== saved;
  }, [selectedDays, savedDays]);

  const toggleDay = (iso: number) => {
    setSelectedDays((prev) => {
      const next = prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso];
      return next.sort((a, b) => a - b);
    });
  };

  const savePattern = async () => {
    setSaving(true);
    const days = [...selectedDays].sort((a, b) => a - b);
    try {
      await saveShiftDays(supabase, driverId, days);
      setSelectedDays(days);
      setSavedDays(days);
    } finally {
      setSaving(false);
    }
  };

  const toggleDateOverride = async (dateStr: string, dayOfWeek: number) => {
    const existing = overrides.find((o) => o.date === dateStr);
    if (existing) {
      if (isPlanner && existing.set_by === "driver") return;
      await supabase.from("driver_availability_overrides").delete().eq("id", existing.id);
      setOverrides((prev) => prev.filter((o) => o.id !== existing.id));
      return;
    }

    const isWorkDay = selectedDays.includes(dayOfWeek);
    const { data } = await supabase
      .from("driver_availability_overrides")
      .insert({
        driver_id: driverId,
        date: dateStr,
        available: !isWorkDay,
        set_by: isPlanner ? "planner" : "driver",
      })
      .select()
      .single();

    if (data) setOverrides((prev) => [...prev, data as DriverAvailabilityOverride]);
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const firstOffset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayLocalDateString();
  const monthName = currentMonth.toLocaleString("default", { month: "long", year: "numeric" });

  const getDateStatus = (dayNum: number) => {
    const date = new Date(year, month, dayNum, 12);
    const dateStr = localDateString(year, month, dayNum);
    const dayOfWeek = date.getDay();
    const override = overrides.find((o) => o.date === dateStr);

    if (override) {
      return {
        dateStr,
        dayOfWeek,
        type: (override.available ? "extra" : "holiday") as DayType,
        locked: isPlanner && override.set_by === "driver",
      };
    }

    return {
      dateStr,
      dayOfWeek,
      type: (selectedDays.includes(dayOfWeek) ? "working" : "off") as DayType,
      locked: false,
    };
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">{INSTRUCTIONS}</p>

      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Weekly Pattern
        </p>
        <div className="flex gap-1.5">
          {DAYS_SHORT.map((day, i) => {
            const iso = DAY_ISO[i];
            const active = selectedDays.includes(iso);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(iso)}
                className="flex-1 py-2.5 rounded-lg text-xs font-bold transition-all active:scale-95"
                style={
                  active
                    ? {
                        background: "oklch(0.62 0.22 245)",
                        color: "white",
                        boxShadow: "0 0 12px oklch(0.62 0.22 245 / 0.35)",
                      }
                    : {
                        background: "oklch(0.25 0.01 240)",
                        color: "oklch(0.55 0.01 240)",
                      }
                }
              >
                {day.slice(0, 2)}
              </button>
            );
          })}
        </div>
        {patternChanged && (
          <button
            type="button"
            onClick={savePattern}
            disabled={saving}
            className="mt-3 w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
            style={{ background: "oklch(0.62 0.22 245)" }}
          >
            {saving ? "Saving…" : "Save Pattern"}
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} className="text-muted-foreground" />
          </button>
          <span className="text-sm font-semibold text-foreground">{monthName}</span>
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="Next month"
          >
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
        </div>

        <div className="grid grid-cols-7 mb-1">
          {DAYS_SHORT.map((d) => (
            <div key={d} className="text-center text-[10px] font-bold text-muted-foreground py-1">
              {d[0]}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstOffset }).map((_, i) => (
            <div key={`e${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const { dateStr, dayOfWeek, type, locked } = getDateStatus(dayNum);
            const isToday = dateStr === today;

            const styles: React.CSSProperties =
              type === "working"
                ? {
                    background: "oklch(0.62 0.22 245 / 0.15)",
                    borderColor: "oklch(0.62 0.22 245 / 0.35)",
                    color: "oklch(0.85 0.05 240)",
                  }
                : type === "holiday"
                  ? {
                      background: "oklch(0.55 0.22 25 / 0.2)",
                      borderColor: "oklch(0.55 0.22 25 / 0.4)",
                      color: "oklch(0.65 0.18 25)",
                    }
                  : type === "extra"
                    ? {
                        background: "oklch(0.55 0.18 145 / 0.2)",
                        borderColor: "oklch(0.55 0.18 145 / 0.4)",
                        color: "oklch(0.65 0.15 145)",
                      }
                    : {
                        background: "transparent",
                        borderColor: "transparent",
                        color: "oklch(0.45 0.01 240)",
                      };

            if (isToday) {
              styles.outline = "2px solid oklch(0.62 0.22 245)";
              styles.outlineOffset = "1px";
            }

            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => toggleDateOverride(dateStr, dayOfWeek)}
                disabled={locked}
                className="relative aspect-square rounded-lg border text-xs font-medium transition-all flex items-center justify-center active:scale-95 disabled:cursor-not-allowed"
                style={styles}
                title={locked ? "Set by driver — cannot be removed" : undefined}
              >
                {dayNum}
                {locked && <Lock size={7} className="absolute bottom-0.5 right-0.5 opacity-50" />}
              </button>
            );
          })}
        </div>

        <div className="flex gap-4 mt-4 flex-wrap">
          {[
            { bg: "oklch(0.62 0.22 245 / 0.3)", label: "Working" },
            { bg: "oklch(0.55 0.22 25 / 0.35)", label: "Holiday" },
            { bg: "oklch(0.55 0.18 145 / 0.3)", label: "Extra day" },
            { bg: "transparent", label: "Off", border: true },
          ].map(({ bg, label, border }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div
                className="w-3 h-3 rounded-sm border border-border"
                style={{
                  background: bg,
                  borderColor: border ? "oklch(0.35 0.01 240)" : "transparent",
                }}
              />
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
