// Per-driver "is the driver scheduled today?" projection.
//
// Source of truth (matches the planner):
//   1. If a driver_availability_overrides row exists for today → use override.available
//   2. Otherwise → driver_shift_templates contains today's weekday
//
// Returns a Record<driverId, ScheduleStatus>. Drivers not yet resolved are
// absent (caller treats them as 'unknown').

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ScheduleStatus } from "@/lib/effective-status";

function todayLocal(): { weekday: number; date: string } {
  const now = new Date();
  const weekday = now.getDay(); // 0=Sun..6=Sat
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { weekday, date };
}

type TemplateRow = { driver_id: string; day_of_week: number };
type OverrideRow = { driver_id: string; available: boolean };

export function useDriverSchedule(driverIds: string[]): Record<string, ScheduleStatus> {
  const [schedule, setSchedule] = useState<Record<string, ScheduleStatus>>({});
  const idsKey = driverIds.slice().sort().join(",");

  // Keep latest in refs so realtime handlers can recompute without re-subbing.
  const templateDaysRef = useRef<Set<string>>(new Set()); // scheduled driver_ids
  const overrideRef = useRef<Map<string, boolean>>(new Map());
  // Unique per hook instance so multiple components using this hook (index,
  // drivers, alerts) never collide on the same Supabase channel topic, which
  // throws "cannot add postgres_changes callbacks after subscribe()".
  const channelId = useRef(Math.random().toString(36).slice(2));

  useEffect(() => {
    if (driverIds.length === 0) {
      setSchedule({});
      return;
    }

    let cancelled = false;
    const { weekday, date } = todayLocal();

    const recompute = () => {
      const next: Record<string, ScheduleStatus> = {};
      for (const id of driverIds) {
        const ov = overrideRef.current.get(id);
        if (ov === true) next[id] = "scheduled";
        else if (ov === false) next[id] = "holiday";
        else next[id] = templateDaysRef.current.has(id) ? "scheduled" : "not_scheduled";
      }
      setSchedule(next);
    };

    // Wrap every async query so an RLS rejection, network blip, or auth
    // expiry never surfaces as an unhandled rejection and crashes the page.
    const safeWrapper = <T>(fn: () => Promise<T>) =>
      fn().catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[useDriverSchedule] query failed, using stale data:", err);
        return undefined;
      });

    (async () => {
      const result = await safeWrapper(async () => {
        const sb = supabase as any;
        return Promise.all([
          sb
            .from("driver_shift_templates")
            .select("driver_id, day_of_week")
            .in("driver_id", driverIds)
            .eq("day_of_week", weekday),
          sb
            .from("driver_availability_overrides")
            .select("driver_id, available")
            .in("driver_id", driverIds)
            .eq("date", date),
        ]);
      });

      if (cancelled || !result) return;

      const [tplRes, ovRes] = result;
      templateDaysRef.current = new Set(
        ((tplRes.data ?? []) as TemplateRow[]).map((r) => r.driver_id),
      );
      overrideRef.current = new Map(
        ((ovRes.data ?? []) as OverrideRow[]).map((r) => [r.driver_id, r.available]),
      );
      recompute();
    })();

    // Realtime: refetch the affected source on any change, then recompute.
    const refetchTemplates = () =>
      safeWrapper(async () => {
        const { data } = await (supabase as any)
          .from("driver_shift_templates")
          .select("driver_id, day_of_week")
          .in("driver_id", driverIds)
          .eq("day_of_week", weekday);
        if (cancelled) return;
        templateDaysRef.current = new Set(((data ?? []) as TemplateRow[]).map((r) => r.driver_id));
        recompute();
      });

    const refetchOverrides = () =>
      safeWrapper(async () => {
        const { data } = await (supabase as any)
          .from("driver_availability_overrides")
          .select("driver_id, available")
          .in("driver_id", driverIds)
          .eq("date", date);
        if (cancelled) return;
        overrideRef.current = new Map(
          ((data ?? []) as OverrideRow[]).map((r) => [r.driver_id, r.available]),
        );
        recompute();
      });

    const tplChannel = supabase
      .channel(`drv-sched-tpl-${channelId.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_shift_templates" },
        refetchTemplates,
      )
      .subscribe();

    const ovChannel = supabase
      .channel(`drv-sched-ov-${channelId.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_availability_overrides" },
        refetchOverrides,
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(tplChannel);
      supabase.removeChannel(ovChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return schedule;
}
