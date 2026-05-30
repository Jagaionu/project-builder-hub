import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DriverPosition = {
  id: string;
  lat: number;
  lon: number;
  created_at: string;
};

/**
 * GPS breadcrumb trail for a single driver, read from `driver_positions`.
 *
 * Refetches whenever `refreshKey` changes — pass the driver's
 * `last_update_time`, which bumps via the `drivers` realtime stream on every
 * accepted GPS ping. This avoids depending on realtime for the partitioned
 * `driver_positions` table (partition inserts don't reliably echo on the
 * parent), while still surfacing each new breadcrumb as it lands.
 */
export function useDriverPositions(
  driverId: string | null | undefined,
  refreshKey?: string | null,
): DriverPosition[] {
  const [positions, setPositions] = useState<DriverPosition[]>([]);

  useEffect(() => {
    if (!driverId) {
      setPositions([]);
      return;
    }
    let mounted = true;
    // Last 24h of breadcrumbs — enough to show the day's trail without pulling
    // the full partitioned history.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    supabase
      .from("driver_positions")
      .select("id,lat,lon,created_at")
      .eq("driver_id", driverId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(2000)
      .then(({ data }) => {
        if (mounted && data) setPositions(data as DriverPosition[]);
      });
    return () => {
      mounted = false;
    };
  }, [driverId, refreshKey]);

  return positions;
}
