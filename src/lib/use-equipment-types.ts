import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as unknown as { from: (t: string) => any };

// Canonical equipment types = the distinct values already used in the data
// (jobs.equipment_type + driver_equipment). Keeps the picker in sync with what
// the planner actually matches against — no invented list, no typos.
export function useEquipmentTypes(): string[] {
  const [types, setTypes] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: j }, { data: de }] = await Promise.all([
        sb.from("jobs").select("equipment_type").not("equipment_type", "is", null).limit(5000),
        sb.from("driver_equipment").select("equipment_type"),
      ]);
      if (cancelled) return;
      const set = new Set<string>();
      for (const r of (j ?? []) as Array<{ equipment_type: string | null }>)
        if (r.equipment_type) set.add(r.equipment_type);
      for (const r of (de ?? []) as Array<{ equipment_type: string | null }>)
        if (r.equipment_type) set.add(r.equipment_type);
      setTypes([...set].sort());
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return types;
}
