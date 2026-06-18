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
  /** Gates access to the driver app: active | suspended (blocked) | deleted (removed). */
  accountStatus: "active" | "suspended" | "deleted";
  suspendedUntil: string | null;
  suspendedReason: string | null;
  setSession: (s: Session | null) => void;
  setDriver: (d: DriverProfile | null) => void;
  setJobs: (j: JobWithStops[]) => void;
  setGpsPosition: (p: GPSPosition | null) => void;
  setOnline: (o: boolean) => void;
  setLegState: (s: LegState) => void;
  setAccountStatus: (
    status: "active" | "suspended" | "deleted",
    info?: { until?: string | null; reason?: string | null },
  ) => void;
  reset: () => void;
}

export const useDriverStore = create<DriverAppState>((set) => ({
  session: null,
  driver: null,
  jobs: [],
  gpsPosition: null,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  legState: INITIAL_LEG_STATE,
  accountStatus: "active",
  suspendedUntil: null,
  suspendedReason: null,
  setSession: (session) => set({ session }),
  setDriver: (driver) => set({ driver }),
  setJobs: (jobs) => set({ jobs }),
  setGpsPosition: (gpsPosition) => set({ gpsPosition }),
  setOnline: (isOnline) => set({ isOnline }),
  setLegState: (legState) => set({ legState }),
  setAccountStatus: (accountStatus, info) =>
    set({
      accountStatus,
      suspendedUntil: info?.until ?? null,
      suspendedReason: info?.reason ?? null,
    }),
  reset: () =>
    set({
      session: null,
      driver: null,
      jobs: [],
      gpsPosition: null,
      legState: INITIAL_LEG_STATE,
      accountStatus: "active",
      suspendedUntil: null,
      suspendedReason: null,
    }),
}));
