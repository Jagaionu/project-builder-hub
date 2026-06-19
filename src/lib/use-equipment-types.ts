import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as unknown as { from: (t: string) => any };

// Standard vehicle/equipment catalogue offered in the picker dropdown. Existing
// values found in the data are merged in after these so nothing is lost.
export const STANDARD_VEHICLE_TYPES = [
  "7.5",
  "Van",
  "Detached Trailer 18t",
  "Detached Trailer",
  "Double Deck Trailer",
  "Drop Trailer",
];

// Canonical equipment types = the standard catalogue above, plus any distinct
// values already used in the data (jobs.equipment_type + driver_equipment), so
// the picker stays in sync with what the planner matches against.
export function useEquipmentTypes(): string[] {
  const [types, setTypes] = useState<string[]>(STANDARD_VEHICLE_TYPES);
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
      // Standard list first (in catalogue order), then any extra data values.
      const extra = [...set].filter((t) => !STANDARD_VEHICLE_TYPES.includes(t)).sort();
      setTypes([...STANDARD_VEHICLE_TYPES, ...extra]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return types;
}
