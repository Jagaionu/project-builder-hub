import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Driver equipment capabilities (driver_equipment table) → { driverId: [types] }.
// Mirrors the planner's equipment gate so ad-hoc driver suggestions only offer
// drivers that can pull the job's equipment_type. If the table isn't readable
// (RLS), the map is empty and callers simply skip the equipment filter.
export function useDriverEquipment(): Record<string, string[]> {
  const [map, setMap] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as unknown as { from: (t: string) => any })
        .from("driver_equipment")
        .select("driver_id, equipment_type");
      if (cancelled || !data) return;
      const next: Record<string, string[]> = {};
      for (const r of data as { driver_id: string; equipment_type: string }[]) {
        (next[r.driver_id] ||= []).push(r.equipment_type);
      }
      setMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return map;
}
