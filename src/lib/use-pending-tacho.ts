import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/lib/tenant-context";

export type PendingTacho = {
  driver_id: string;
  day: string;
  tachograph_drive_minutes: number;
  drive_minutes: number; // our chain estimate, for the variance display
};

const sb = supabase as unknown as { from: (t: string) => any };

// Driver-day rows where the driver's tachograph entry is awaiting planner
// approval. Used by the Driver Hours card, the Drivers tab, and the sidebar.
export function usePendingTacho() {
  const [rows, setRows] = useState<PendingTacho[]>([]);
  const { userId } = useTenant();

  const load = useCallback(async () => {
    const { data } = await sb
      .from("driver_day_hours")
      .select("driver_id,day,tachograph_drive_minutes,drive_minutes")
      .eq("tachograph_status", "pending");
    setRows((data ?? []) as PendingTacho[]);
  }, []);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("rt-pending-tacho-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_day_hours" }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const approve = useCallback(
    async (driverId: string, day: string) => {
      await sb
        .from("driver_day_hours")
        .update({ tachograph_status: "approved", tachograph_approved_at: new Date().toISOString(), tachograph_approved_by: userId })
        .eq("driver_id", driverId)
        .eq("day", day);
      await load();
    },
    [load, userId],
  );

  const reject = useCallback(
    async (driverId: string, day: string) => {
      await sb
        .from("driver_day_hours")
        .update({ tachograph_status: null, tachograph_drive_minutes: null, tachograph_entered_at: null, tachograph_entered_by: null })
        .eq("driver_id", driverId)
        .eq("day", day);
      await load();
    },
    [load],
  );

  const byDriver = useMemo(() => {
    const m: Record<string, PendingTacho[]> = {};
    for (const r of rows) (m[r.driver_id] ||= []).push(r);
    return m;
  }, [rows]);

  return { rows, byDriver, driverCount: Object.keys(byDriver).length, approve, reject };
}
