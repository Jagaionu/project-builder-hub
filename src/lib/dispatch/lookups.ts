import { useMemo } from "react";
import type { Driver, Warehouse, Job } from "@/lib/types";

/**
 * Build O(1) lookup Maps once per data change. Replaces N×M Array.find scans
 * (drivers.find, warehouses.find, jobs.find) which become quadratic at scale.
 */
export function useLookups(jobs: Job[], drivers: Driver[], warehouses: Warehouse[]) {
  const jobsById = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs) m.set(j.id, j);
    return m;
  }, [jobs]);

  const driversById = useMemo(() => {
    const m = new Map<string, Driver>();
    for (const d of drivers) m.set(d.id, d);
    return m;
  }, [drivers]);

  const warehousesById = useMemo(() => {
    const m = new Map<string, Warehouse>();
    for (const w of warehouses) m.set(w.id, w);
    return m;
  }, [warehouses]);

  return { jobsById, driversById, warehousesById };
}

export type Lookups = ReturnType<typeof useLookups>;
