import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchShiftDays, saveShiftDays } from "@/lib/driver-shifts";
import type { DriverAvailabilityOverride } from "@/lib/types";

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_ISO = [1, 2, 3, 4, 5, 6, 0];

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

const CELL_BASE =
  "relative aspect-square rounded-md border text-[10px] font-medium flex items-center justify-center " +
  "transition active:scale-95 hover:brightness-110 focus-visible:outline-none " +
  "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 " +
  "focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100";

function cellClass(type: DayType, isToday: boolean, isPast: boolean) {
  const variant =
    type === "working"
      ? "bg-[var(--shift-working)] border-[var(--shift-working-border)] text-[var(--shift-working-fg)]"
      : type === "holiday"
        ? "bg-[var(--shift-holiday)] border-[var(--shift-holiday-border)] text-[var(--shift-holiday-fg)]"
        : type === "extra"
          ? "bg-[var(--shift-extra)] border-[var(--shift-extra-border)] text-[var(--shift-extra-fg)]"
          : "bg-transparent border-transparent text-[var(--shift-off-fg)]";

  const today = isToday
    ? " ring-1 ring-[var(--shift-today-ring)] font-bold"
    : "";
  const past = isPast ? " opacity-40" : "";
  return `${CELL_BASE} ${variant}${today}${past}`;
}

export function ShiftCalendar({ driverId, isPlanner = false }: ShiftCalendarProps) {
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [savedDays, setSavedDays] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<DriverAvailabilityOverride[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await fetchShiftDays(supabase, driverId);
      if (cancelled) return;
      setSelectedDays(loaded);
      setSavedDays(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  useEffect(() => {
    let cancelled = false;
    setOverridesLoading(true);
    (async () => {
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

      if (!cancelled) {
        setOverrides((data ?? []) as DriverAvailabilityOverride[]);
        setOverridesLoading(false);
      }
    })();
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
      toast.success("Weekly pattern saved");
    } catch (err) {
      toast.error("Couldn't save pattern", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  };

  const discardPattern = () => {
    setSelectedDays([...savedDays]);
  };

  const toggleDateOverride = async (dateStr: string, dayOfWeek: number) => {
    const existing = overrides.find((o) => o.date === dateStr);
    if (existing) {
      if (isPlanner && existing.set_by === "driver") return;
      const prev = overrides;
      setOverrides((p) => p.filter((o) => o.id !== existing.id));
      const { error } = await supabase
        .from("driver_availability_overrides")
        .delete()
        .eq("id", existing.id);
      if (error) {
        setOverrides(prev);
        toast.error("Couldn't update that day");
      }
      return;
    }

    const isWorkDay = selectedDays.includes(dayOfWeek);
    const { data, error } = await supabase
      .from("driver_availability_overrides")
      .insert({
        driver_id: driverId,
        date: dateStr,
        available: !isWorkDay,
        set_by: isPlanner ? "planner" : "driver",
      })
      .select()
      .single();

    if (error) {
      toast.error("Couldn't update that day");
      return;
    }
    if (data) setOverrides((prev) => [...prev, data as DriverAvailabilityOverride]);
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const firstOffset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayLocalDateString();
  const monthName = currentMonth.toLocaleString("default", { month: "short", year: "numeric" });
  const isCurrentMonth =
    year === new Date().getFullYear() && month === new Date().getMonth();

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
    <div className="space-y-3">
      {/* Weekly pattern */}
      <div className="bg-card/50 border border-border/50 rounded-lg p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Weekly Pattern
        </p>
        <div className="flex gap-1">
          {DAYS_SHORT.map((day, i) => {
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
        {patternChanged && (
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={discardPattern}
              disabled={saving}
              className="flex-1 py-1 rounded-md text-[10px] font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition active:scale-95 disabled:opacity-60"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={savePattern}
              disabled={saving}
              className="flex-1 py-1 rounded-md text-[10px] font-semibold bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-60"
            >
              {saving ? "…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {/* Month grid */}
      <div className="bg-card/50 border border-border/50 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
            className="p-1 rounded-md hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Previous month"
          >
            <ChevronLeft size={14} className="text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
            disabled={isCurrentMonth}
            className="text-[11px] font-bold text-foreground hover:text-primary transition-colors disabled:hover:text-foreground disabled:cursor-default focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1.5 py-0.5"
            title={isCurrentMonth ? undefined : "Jump to today"}
          >
            {monthName}
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
            className="p-1 rounded-md hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Next month"
          >
            <ChevronRight size={14} className="text-muted-foreground" />
          </button>
        </div>

        <div className="grid grid-cols-7 mb-0.5">
          {DAYS_SHORT.map((d) => (
            <div
              key={d}
              className="text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70 py-0.5"
            >
              {d.slice(0, 2)}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstOffset }).map((_, i) => (
            <div key={`e${i}`} />
          ))}
          {overridesLoading
            ? Array.from({ length: daysInMonth }).map((_, i) => (
                <div
                  key={`s${i}`}
                  className="aspect-square rounded-md skeleton"
                />
              ))
            : Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const { dateStr, dayOfWeek, type, locked } = getDateStatus(dayNum);
                const isToday = dateStr === today;
                const isPast = dateStr < today;

                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => toggleDateOverride(dateStr, dayOfWeek)}
                    disabled={locked || isPast}
                    className={cellClass(type, isToday, isPast)}
                    title={
                      locked
                        ? "Set by driver"
                        : isPast
                          ? "Past date"
                          : undefined
                    }
                  >
                    {dayNum}
                    {locked && (
                      <Lock
                        size={6}
                        className="absolute bottom-0.5 right-0.5 opacity-60"
                      />
                    )}
                  </button>
                );
              })}
        </div>

        <div className="flex gap-2 mt-3 flex-wrap">
          {[
            { cls: "bg-[var(--shift-working)] border-[var(--shift-working-border)]", label: "Working" },
            { cls: "bg-[var(--shift-holiday)] border-[var(--shift-holiday-border)]", label: "Holiday" },
            { cls: "bg-[var(--shift-extra)] border-[var(--shift-extra-border)]", label: "Extra" },
            { cls: "bg-transparent border-border", label: "Off" },
          ].map(({ cls, label }) => (
            <div key={label} className="flex items-center gap-1" title={label}>
              <div className={`w-2 h-2 rounded-full border ${cls}`} />
              <span className="text-[9px] text-muted-foreground/80">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
