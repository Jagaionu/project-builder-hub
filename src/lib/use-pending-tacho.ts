import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/lib/tenant-context";
import { weekStartOf, addWeeks, ukToday } from "@/lib/week";

const sb = supabase as unknown as { from: (t: string) => any };

type WeekRow = { driver_id: string; week_start: string; tacho_drive_minutes: number; status: string };
type DayRow = { driver_id: string; day: string; drive_minutes: number | null };
export type PendingWeek = { driver_id: string; week_start: string; tacho_drive_minutes: number; estimate: number };

// Weekly tachograph reconciliation: approved week totals override our estimate;
// pending weeks await planner approval. Backed by public.driver_week_hours.
export function usePendingTacho() {
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [days, setDays] = useState<DayRow[]>([]);
  const { userId } = useTenant();

  const load = useCallback(async () => {
    const since = addWeeks(weekStartOf(ukToday()), -3);
    const [{ data: w }, { data: d }] = await Promise.all([
      sb.from("driver_week_hours").select("driver_id,week_start,tacho_drive_minutes,status").gte("week_start", since),
      sb.from("driver_day_hours").select("driver_id,day,drive_minutes").gte("day", since),
    ]);
    setWeeks((w ?? []) as WeekRow[]);
    setDays((d ?? []) as DayRow[]);
  }, []);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("rt-week-tacho-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_week_hours" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const estByDriverWeek = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const r of days) {
      const wk = weekStartOf(r.day);
      (m[r.driver_id] ||= {});
      m[r.driver_id][wk] = (m[r.driver_id][wk] ?? 0) + (r.drive_minutes ?? 0);
    }
    return m;
  }, [days]);

  const approvedByDriver = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const w of weeks) if (w.status === "approved") (m[w.driver_id] ||= {})[w.week_start] = w.tacho_drive_minutes;
    return m;
  }, [weeks]);

  const byDriver = useMemo(() => {
    const m: Record<string, PendingWeek[]> = {};
    for (const w of weeks)
      if (w.status === "pending")
        (m[w.driver_id] ||= []).push({
          driver_id: w.driver_id,
          week_start: w.week_start,
          tacho_drive_minutes: w.tacho_drive_minutes,
          estimate: estByDriverWeek[w.driver_id]?.[w.week_start] ?? 0,
        });
    return m;
  }, [weeks, estByDriverWeek]);

  const approve = useCallback(async (driverId: string, weekStart: string) => {
    await sb.from("driver_week_hours")
      .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: userId })
      .eq("driver_id", driverId).eq("week_start", weekStart);
    await load();
  }, [load, userId]);

  const reject = useCallback(async (driverId: string, weekStart: string) => {
    await sb.from("driver_week_hours").delete().eq("driver_id", driverId).eq("week_start", weekStart);
    await load();
  }, [load]);

  return { byDriver, approvedByDriver, driverCount: Object.keys(byDriver).length, approve, reject };
}
