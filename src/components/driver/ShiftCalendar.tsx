import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchShiftPattern } from "@/lib/driver-shifts";
import { ShiftPatternEditor } from "@/components/driver/ShiftPatternEditor";
import type { DriverAvailabilityOverride } from "@/lib/types";

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_ISO = [1, 2, 3, 4, 5, 6, 0];

interface ShiftCalendarProps {
  driverId: string;
  isPlanner?: boolean;
  /** When false, hide the weekly ShiftPatternEditor and render only the month grid. Defaults true. */
  showPatternEditor?: boolean;
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
  "relative aspect-square rounded-md border text-[10px] font-medium flex flex-col items-center justify-center gap-0.5 " +
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

export function ShiftCalendar({ driverId, isPlanner = false, showPatternEditor = true }: ShiftCalendarProps) {
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [initialTimes, setInitialTimes] = useState<Record<number, { start_time: string | null; end_time: string | null }>>({});
  const [overrides, setOverrides] = useState<DriverAvailabilityOverride[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(true);
  const [patternVersion, setPatternVersion] = useState(0);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const patternKeyRef = useRef(0);

  // Load the full shift pattern (days + per-day times).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pattern = await fetchShiftPattern(supabase, driverId);
        if (cancelled) return;
        setSelectedDays(pattern.days_of_week);
        setInitialTimes(pattern.shiftByDay);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ShiftCalendar] fetchShiftPattern failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, patternVersion]);

  useEffect(() => {
    let cancelled = false;
    setOverridesLoading(true);
    (async () => {
      try {
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
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ShiftCalendar] overrides fetch failed:", err);
        if (!cancelled) setOverridesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driverId, currentMonth]);

  // Called by ShiftPatternEditor after a successful save. Bumps a counter to
  // trigger a re-fetch of the pattern so the calendar grid refreshes.
  const handlePatternSaved = () => {
    setPatternVersion((v) => v + 1);
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
      } as never)
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
      {/* Shift pattern editor with per-day times */}
      {showPatternEditor && (
        <ShiftPatternEditor
          key={`pattern-${patternKeyRef.current}`}
          driverId={driverId}
          isPlanner={isPlanner}
          initialDays={selectedDays}
          initialTimes={initialTimes}
          onSave={handlePatternSaved}
        />
      )}

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
                // Drivers may only change FUTURE days (from tomorrow) — same-day
                // edits are locked so the planner isn't blindsided by last-minute
                // changes. The planner view can still edit today.
                const driverLockedToday = !isPlanner && isToday;
                const dayTimes = type === "working" ? initialTimes[dayOfWeek] : undefined;
                const startHM = dayTimes?.start_time ? dayTimes.start_time.slice(0, 5) : null;
                const endHM = dayTimes?.end_time ? dayTimes.end_time.slice(0, 5) : null;

                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => toggleDateOverride(dateStr, dayOfWeek)}
                    disabled={locked || isPast || driverLockedToday}
                    className={cellClass(type, isToday, isPast)}
                    title={
                      locked
                        ? "Set by driver"
                        : driverLockedToday
                          ? "Same-day changes are locked — ask your planner"
                          : isPast
                          ? "Past date"
                          : startHM && endHM
                            ? `${startHM}–${endHM}`
                            : undefined
                    }
                  >
                    <span className="leading-none">{dayNum}</span>
                    {startHM && endHM && (
                      <span className="flex flex-col items-center leading-none gap-[1px] font-normal opacity-80">
                        <span className="text-[7px]">{startHM}</span>
                        <span className="text-[7px]">{endHM}</span>
                      </span>
                    )}
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
