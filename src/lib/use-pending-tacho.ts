import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { weekStartOf, addWeeks, ukToday } from "@/lib/week";

const sb = supabase as unknown as { from: (t: string) => any };

type SubRow = { driver_id: string; period_start: string; drive_minutes: number | null; status: string };

// Submitted weekly tachograph totals override the GPS estimate in the compliance
// rings. Backed by tachograph_requests (status=submitted); keyed by week start
// (period_start). Drivers submit via the forced modal — there is no approval step.
export function usePendingTacho() {
  const [rows, setRows] = useState<SubRow[]>([]);
  useEffect(() => {
    const since = addWeeks(weekStartOf(ukToday()), -3);
    const load = async () => {
      const { data } = await sb
        .from("tachograph_requests")
        .select("driver_id,period_start,drive_minutes,status")
        .eq("status", "submitted")
        .gte("period_start", since);
      setRows((data ?? []) as SubRow[]);
    };
    void load();
    const ch = supabase
      .channel("rt-tacho-sub-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "tachograph_requests" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const approvedByDriver = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const r of rows) if (r.drive_minutes != null) (m[r.driver_id] ||= {})[r.period_start] = r.drive_minutes;
    return m;
  }, [rows]);

  return { approvedByDriver };
}
