import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";
import {
  watchPosition,
  haversineKm,
  GPS_PING_INTERVAL_MS,
  GPS_ACTIVE_PING_INTERVAL_MS,
  type GPSPosition,
} from "@/lib/driver-gps";
import { gpsSeam } from "@/lib/driver/gps-seam";
import { getDeviceId } from "@/lib/device-id";
import { checkGeofences } from "@/lib/leg-tracker";
import type { JobWithStops, DriverProfile } from "@/lib/driver-types";

function evaluateAccount(d: {
  suspended?: boolean | null;
  suspended_until?: string | null;
  suspended_reason?: string | null;
}) {
  const stillSuspended =
    !!d.suspended && (!d.suspended_until || new Date(d.suspended_until).getTime() > Date.now());
  useDriverStore
    .getState()
    .setAccountStatus(stillSuspended ? "suspended" : "active", {
      until: d.suspended_until ?? null,
      reason: d.suspended_reason ?? null,
    });
}

async function loadDriver(userId: string) {
  // select("*") is intentional: it tolerates the suspension columns not yet
  // existing (pre-migration) instead of erroring on unknown columns.
  const { data: driver, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const store = useDriverStore.getState();
  if (!driver && !error) {
    // Session is valid but there is no driver record → the account was deleted.
    store.setDriver(null);
    store.setAccountStatus("deleted");
    return;
  }
  store.setDriver((driver as DriverProfile | null) ?? null);
  if (driver) {
    // Device binding guard: if this driver's code has since been paired on a
    // different device, this one is no longer the active device — sign out.
    const boundId = (driver as { bound_device_id?: string | null }).bound_device_id ?? null;
    const localId = getDeviceId();
    if (boundId && localId && boundId !== localId) {
      try {
        sessionStorage.setItem("driver.superseded", "1");
      } catch {
        /* ignore */
      }
      store.setDriver(null);
      await supabase.auth.signOut();
      return;
    }
    evaluateAccount(driver as Record<string, unknown>);
    await refreshJobs(driver.id);
    registerPush(driver.id).catch((e) => console.warn("[push] register failed", e));
  }
}

// Re-check the bound device for the signed-in driver and self-eject on a
// mismatch. Cheap enough to run when the tab regains focus so an old device is
// kicked promptly after the code is moved to a new phone.
async function verifyBoundDevice() {
  const d = useDriverStore.getState().driver;
  if (!d) return;
  const { data } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", d.id)
    .maybeSingle();
  const boundId = (data as { bound_device_id?: string | null } | null)?.bound_device_id ?? null;
  const localId = getDeviceId();
  if (boundId && localId && boundId !== localId) {
    try {
      sessionStorage.setItem("driver.superseded", "1");
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut();
  }
}

// Capture the browser's push subscription so the dispatcher backend can
// notify this driver before the planner runs. Silently no-ops when the
// browser doesn't support Push, the user denies permission, or the VAPID
// public key isn't configured.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registerPush(driverId: string) {
  if (typeof window === "undefined") return;
  if (!("PushManager" in window) || !("serviceWorker" in navigator)) return;
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidKey) return; // not configured — server-side push send isn't wired yet
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }));
    const subJson = sub.toJSON();
    const keys = (subJson.keys ?? {}) as Record<string, string>;
    if (!subJson.endpoint || !keys.p256dh || !keys.auth) return;
    await supabase.from("driver_push_subscriptions").upsert(
      {
        driver_id: driverId,
        endpoint: subJson.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "driver_id" },
    );
  } catch (e) {
    console.warn("[push] subscription failed", e);
  }
}

async function refreshJobs(driverId: string) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = today.toISOString().slice(0, 10);
  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "id,reference,status,for_date,planned_start_at,scheduled_at,assigned_driver_id,planned_driver_id,stops:job_stops(id,job_id,warehouse_id,kind,seq,arrived_at,scheduled_at,warehouse:warehouses(id,code,name,address,latitude,longitude))",
    )
    .or(`assigned_driver_id.eq.${driverId},planned_driver_id.eq.${driverId}`)
    .gte("for_date", from)
    .order("planned_start_at", { ascending: true, nullsFirst: true });
  useDriverStore.getState().setJobs((jobs ?? []) as unknown as JobWithStops[]);
}

const MIN_INTERVAL_MS = 30_000;
const MIN_MOVE_KM = 0.05;

// Geofence radius for automatic arrival confirmation (~200 m) — matches the
// leg-tracker; a driver can enter at any gate and GPS is only sampled
// periodically, so allow generous slack around the warehouse coordinate.
const ARRIVAL_RADIUS_KM = 0.2;
const arrivingStops = new Set<string>();

async function autoArriveNearby(driverId: string, p: GPSPosition) {
  const jobs = useDriverStore.getState().jobs;
  const updates: { jobId: string; stopId: string; arrivedIso: string; inferred: boolean }[] = [];
  for (const job of jobs) {
    if (["COMPLETED", "CANCELLED", "PENDING"].includes(job.status)) continue;
    const sorted = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);
    // Furthest stop (by seq) the driver is physically within range of right now.
    let reachedSeq = -1;
    for (const stop of sorted) {
      if (!stop.warehouse) continue;
      const d = haversineKm(p.lat, p.lon, stop.warehouse.latitude, stop.warehouse.longitude);
      if (d <= ARRIVAL_RADIUS_KM) reachedSeq = Math.max(reachedSeq, stop.seq);
    }
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    for (const stop of sorted) {
      if (stop.arrived_at || !stop.warehouse || arrivingStops.has(stop.id)) continue;
      const d = haversineKm(p.lat, p.lon, stop.warehouse.latitude, stop.warehouse.longitude);
      if (d <= ARRIVAL_RADIUS_KM) {
        // GPS-confirmed arrival (driver is physically here).
        updates.push({ jobId: job.id, stopId: stop.id, arrivedIso: nowIso, inferred: false });
      } else if (reachedSeq >= 0 && stop.seq < reachedSeq && stop.scheduled_at) {
        // Inferred passage: an EARLIER stop on a sequential route the driver has
        // provably passed (they are now in range of a LATER stop) and whose
        // planned time has already arrived. Stamped at the planned time, so it
        // shows as SYSTEM (inferred), not a real GPS capture.
        const planned = new Date(stop.scheduled_at).getTime();
        if (planned && planned <= nowMs) {
          updates.push({
            jobId: job.id,
            stopId: stop.id,
            arrivedIso: stop.scheduled_at,
            inferred: true,
          });
        }
      }
    }
  }
  for (const u of updates) {
    arrivingStops.add(u.stopId);
    const { error } = await supabase
      .from("job_stops")
      .update({ arrived_at: u.arrivedIso } as never)
      .eq("id", u.stopId)
      .is("arrived_at", null);
    if (error) {
      arrivingStops.delete(u.stopId);
      continue;
    }
    await supabase.from("driver_events").insert({
      driver_id: driverId,
      type: "ARRIVED",
      payload: { stop_id: u.stopId, auto: true, inferred: u.inferred },
    } as never);
    useDriverStore.getState().setJobs(
      useDriverStore.getState().jobs.map((j) =>
        j.id !== u.jobId
          ? j
          : {
              ...j,
              stops: j.stops.map((s) =>
                s.id === u.stopId ? { ...s, arrived_at: u.arrivedIso } : s,
              ),
            },
      ),
    );
  }
}

export function useDriverBootstrap() {
  const setSession = useDriverStore((s) => s.setSession);
  const setOnline = useDriverStore((s) => s.setOnline);
  const setGpsPosition = useDriverStore((s) => s.setGpsPosition);
  const lastSent = useRef<GPSPosition | null>(null);
  const stopWatchRef = useRef<(() => void) | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // heartbeatRef removed — GPS cadence is owned by driver-gps.watchPosition.

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setSession(session);
      useDriverStore.getState().setAuthResolved(true);
      if (session?.user) {
        loadDriver(session.user.id);
      } else {
        useDriverStore.getState().reset();
      }
    });
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        if (data.session?.user) loadDriver(data.session.user.id);
      })
      .finally(() => useDriverStore.getState().setAuthResolved(true));

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const onPosition = (p: GPSPosition) => {
      setGpsPosition(p);
      useDriverStore.getState().setGpsError(null);
      gpsSeam.push({ latitude: p.lat, longitude: p.lon, time: p.ts, accuracy: p.accuracy });
      const driver = useDriverStore.getState().driver;
      if (!driver) return;

      // Leg-based geofence tracking (records driving_legs + stop_dwells)
      checkGeofences(p, driver.id).catch((e) => console.error("[geofence]", e));
      // Legacy fallback: also auto-confirm arrival on existing stops
      autoArriveNearby(driver.id, p);

      const prev = lastSent.current;
      const movedEnough = !prev || haversineKm(prev.lat, prev.lon, p.lat, p.lon) >= MIN_MOVE_KM;
      const timeEnough = !prev || p.ts - prev.ts >= MIN_INTERVAL_MS;
      if (!movedEnough && !timeEnough) return;
      lastSent.current = p;
      const now = new Date().toISOString();
      supabase
        .from("driver_positions")
        .insert({ driver_id: driver.id, lat: p.lat, lon: p.lon } as never)
        .then(({ error }) => {
          if (error) console.warn("[gps] driver_positions insert failed:", error.message);
        });
      supabase
        .from("drivers")
        .update({ current_lat: p.lat, current_lon: p.lon, last_update_time: now })
        .eq("id", driver.id)
        .then(({ error }) => {
          if (error) console.warn("[gps] drivers update failed:", error.message);
        });
    };

    const onGpsError = (err: GeolocationPositionError) => {
      console.warn("[gps] position error:", err.code, err.message);
      useDriverStore.getState().setGpsError({ code: err.code, message: err.message });
    };
    const ACTIVE_STATUSES = ["ASSIGNED", "IN_PROGRESS", "ARRIVED_PICKUP", "EN_ROUTE_DELIVERY"];
    // Ping every 60s while the driver has an active route (so arrivals/departures
    // are captured), else fall back to the battery-friendly 5-min idle cadence.
    const getIntervalMs = () =>
      useDriverStore.getState().jobs.some((j) => ACTIVE_STATUSES.includes(j.status))
        ? GPS_ACTIVE_PING_INTERVAL_MS
        : GPS_PING_INTERVAL_MS;
    const startWatch = () => {
      if (stopWatchRef.current) return;
      stopWatchRef.current = watchPosition(onPosition, onGpsError, getIntervalMs);
    };
    const restartWatch = () => {
      stopWatchRef.current?.();
      stopWatchRef.current = null;
      startWatch();
    };
    startWatch();

    // Wake Lock — keep the screen from sleeping while the driver is on shift.
    // Browsers throttle GPS aggressively when the screen is off, so this is
    // the most reliable way to keep updates flowing in the background.
    const acquireWakeLock = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> };
        };
        if (!nav.wakeLock) return;
        const driver = useDriverStore.getState().driver;
        if (!driver || driver.status === "OFF_SHIFT") return;
        if (wakeLockRef.current) return;
        wakeLockRef.current = await nav.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      } catch {
        // Permission/policy denied — silently ignore, GPS will still work
        // while the tab is visible.
      }
    };
    acquireWakeLock();

    // When the user returns to the tab, the browser may have paused GPS.
    // Force a fresh position and re-establish the watch.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void verifyBoundDevice();
      acquireWakeLock();
      restartWatch();
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            onPosition({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              ts: pos.timestamp,
            }),
          onGpsError,
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // GPS ping cadence is now owned by driver-gps.watchPosition (5-min
    // setInterval). No separate 60s heartbeat — that was layered on top of
    // the old watchPosition stream and is now redundant.

    return () => {
      sub.subscription.unsubscribe();
      gpsSeam.stop();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      stopWatchRef.current?.();
      stopWatchRef.current = null;
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [setSession, setOnline, setGpsPosition]);

  const driverId = useDriverStore((s) => s.driver?.id);
  useEffect(() => {
    if (!driverId) return;
    const ch = supabase
      .channel(`driver-${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "jobs",
          filter: `assigned_driver_id=eq.${driverId}`,
        },
        () => refreshJobs(driverId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: `planned_driver_id=eq.${driverId}` },
        () => refreshJobs(driverId),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "job_stops" }, () =>
        refreshJobs(driverId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drivers", filter: `id=eq.${driverId}` },
        (payload) => {
          const store = useDriverStore.getState();
          if (payload.eventType === "DELETE") {
            store.setAccountStatus("deleted");
            return;
          }
          const n = payload.new as Record<string, unknown>;
          evaluateAccount(n);
          store.setDriver(n as unknown as DriverProfile);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [driverId]);
}
