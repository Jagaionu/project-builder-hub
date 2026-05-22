import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { DriverProfile, JobWithStops } from "./driver-types";
import type { GPSPosition } from "./driver-gps";

interface DriverAppState {
  session: Session | null;
  driver: DriverProfile | null;
  jobs: JobWithStops[];
  gpsPosition: GPSPosition | null;
  isOnline: boolean;
  setSession: (s: Session | null) => void;
  setDriver: (d: DriverProfile | null) => void;
  setJobs: (j: JobWithStops[]) => void;
  setGpsPosition: (p: GPSPosition | null) => void;
  setOnline: (o: boolean) => void;
  reset: () => void;
}

export const useDriverStore = create<DriverAppState>((set) => ({
  session: null,
  driver: null,
  jobs: [],
  gpsPosition: null,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  setSession: (session) => set({ session }),
  setDriver: (driver) => set({ driver }),
  setJobs: (jobs) => set({ jobs }),
  setGpsPosition: (gpsPosition) => set({ gpsPosition }),
  setOnline: (isOnline) => set({ isOnline }),
  reset: () => set({ session: null, driver: null, jobs: [], gpsPosition: null }),
}));
