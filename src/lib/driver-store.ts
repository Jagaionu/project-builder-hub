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
  gpsError: { code: number; message: string } | null;
  isOnline: boolean;
  legState: LegState;
  /** Gates access to the driver app: active | suspended (blocked) | deleted (removed). */
  accountStatus: "active" | "suspended" | "deleted";
  suspendedUntil: string | null;
  suspendedReason: string | null;
  /** True once the initial Supabase session check has completed (avoids the
   *  login-screen flash for already-signed-in drivers). Stays true after. */
  authResolved: boolean;
  setSession: (s: Session | null) => void;
  setDriver: (d: DriverProfile | null) => void;
  setJobs: (j: JobWithStops[]) => void;
  setGpsPosition: (p: GPSPosition | null) => void;
  setGpsError: (e: { code: number; message: string } | null) => void;
  setOnline: (o: boolean) => void;
  setLegState: (s: LegState) => void;
  setAccountStatus: (
    status: "active" | "suspended" | "deleted",
    info?: { until?: string | null; reason?: string | null },
  ) => void;
  setAuthResolved: (v: boolean) => void;
  reset: () => void;
}

export const useDriverStore = create<DriverAppState>((set) => ({
  session: null,
  driver: null,
  jobs: [],
  gpsPosition: null,
  gpsError: null,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  legState: INITIAL_LEG_STATE,
  accountStatus: "active",
  suspendedUntil: null,
  suspendedReason: null,
  authResolved: false,
  setSession: (session) => set({ session }),
  setDriver: (driver) => set({ driver }),
  setJobs: (jobs) => set({ jobs }),
  setGpsPosition: (gpsPosition) => set({ gpsPosition }),
  setGpsError: (gpsError) => set({ gpsError }),
  setOnline: (isOnline) => set({ isOnline }),
  setLegState: (legState) => set({ legState }),
  setAccountStatus: (accountStatus, info) =>
    set({
      accountStatus,
      suspendedUntil: info?.until ?? null,
      suspendedReason: info?.reason ?? null,
    }),
  setAuthResolved: (authResolved) => set({ authResolved }),
  reset: () =>
    set({
      session: null,
      driver: null,
      jobs: [],
      gpsPosition: null,
      gpsError: null,
      legState: INITIAL_LEG_STATE,
      accountStatus: "active",
      suspendedUntil: null,
      suspendedReason: null,
    }),
}));
