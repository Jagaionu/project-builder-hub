import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { DriverProfile, JobWithStops } from "./driver-types";
import type { GPSPosition } from "./driver-gps";

export type LegState = {
  activeLegId: string | null;
  activeDwellId: string | null;
  currentJobId: string | null;
  lastKnownWarehouseId: string | null;
};

const INITIAL_LEG_STATE: LegState = {
  activeLegId: null,
  activeDwellId: null,
  currentJobId: null,
  lastKnownWarehouseId: null,
};

interface DriverAppState {
  session: Session | null;
  driver: DriverProfile | null;
  jobs: JobWithStops[];
  gpsPosition: GPSPosition | null;
  isOnline: boolean;
  legState: LegState;
  setSession: (s: Session | null) => void;
  setDriver: (d: DriverProfile | null) => void;
  setJobs: (j: JobWithStops[]) => void;
  setGpsPosition: (p: GPSPosition | null) => void;
  setOnline: (o: boolean) => void;
  setLegState: (s: LegState) => void;
  reset: () => void;
}

export const useDriverStore = create<DriverAppState>((set) => ({
  session: null,
  driver: null,
  jobs: [],
  gpsPosition: null,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  legState: INITIAL_LEG_STATE,
  setSession: (session) => set({ session }),
  setDriver: (driver) => set({ driver }),
  setJobs: (jobs) => set({ jobs }),
  setGpsPosition: (gpsPosition) => set({ gpsPosition }),
  setOnline: (isOnline) => set({ isOnline }),
  setLegState: (legState) => set({ legState }),
  reset: () =>
    set({ session: null, driver: null, jobs: [], gpsPosition: null, legState: INITIAL_LEG_STATE }),
}));
