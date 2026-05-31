// Loads each driver's active jobs (with stops + warehouse coords) so the
// dispatcher UI can compute effective status and projected route hours
// without each row hitting the DB separately.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ActiveStop = {
  seq: number;
  kind: "PICKUP" | "DROP";
  warehouse_id: string;
  scheduled_at: string | null;
  arrived_at: string | null;
  warehouse: { id: string; code: string; latitude: number; longitude: number } | null;
};

export type ActiveJob = {
  id: string;
  status: string;
  assigned_driver_id: string | null;
  planned_driver_id: string | null;
  planned_start_at: string | null;
  scheduled_at: string | null;
  for_date: string | null;
  stops: ActiveStop[];
};

const ACTIVE = ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"];

export function useActiveJobsByDriver(): Record<string, ActiveJob[]> {
  const [map, setMap] = useState<Record<string, ActiveJob[]>>({});
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const { data } = await supabase
          .from("jobs")
          .select(
            "id,status,assigned_driver_id,planned_driver_id,planned_start_at,scheduled_at,for_date,stops:job_stops(seq,kind,warehouse_id,scheduled_at,arrived_at,warehouse:warehouses(id,code,latitude,longitude))",
          )
          .in("status", ACTIVE as never[]);
        if (!mounted || !data) return;
        const m: Record<string, ActiveJob[]> = {};
        for (const j of data as unknown as ActiveJob[]) {
          const id = j.assigned_driver_id ?? j.planned_driver_id;
          if (!id) continue;
          (m[id] ||= []).push(j);
        }
        setMap(m);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useActiveJobsByDriver] query failed:", err);
      }
    };
    load();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoad = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => { void load(); }, 500);
    };
    const ch = supabase
      .channel(`rt-active-jobs-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_stops" }, debouncedLoad)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return map;
}
