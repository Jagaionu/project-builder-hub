import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";
import { watchPosition, haversineKm, type GPSPosition } from "@/lib/driver-gps";
import { checkGeofences } from "@/lib/leg-tracker";
import type { JobWithStops, DriverProfile } from "@/lib/driver-types";

async function loadDriver(userId: string) {
  const { data: driver } = await supabase
    .from("drivers")
    .select("id,user_id,name,status,available_tomorrow,last_update_time,current_lat,current_lon")
    .eq("user_id", userId)
    .maybeSingle();
  useDriverStore.getState().setDriver((driver as DriverProfile | null) ?? null);
  if (driver) {
    await refreshJobs(driver.id);
    registerPush(driver.id).catch((e) => console.warn("[push] register failed", e));
  }
}

// Capture the browser's push subscription so the dispatcher backend can
// notify this driver before the planner runs. Silently no-ops when the
// browser doesn't support Push, the user denies permission, or the VAPID
// public key isn't configured.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
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
    await supabase
      .from("driver_push_subscriptions")
      .upsert(
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
    .select("id,reference,status,for_date,planned_start_at,scheduled_at,assigned_driver_id,planned_driver_id,stops:job_stops(id,job_id,warehouse_id,kind,seq,arrived_at,scheduled_at,warehouse:warehouses(id,code,name,address,latitude,longitude))")
    .or(`assigned_driver_id.eq.${driverId},planned_driver_id.eq.${driverId}`)
    .gte("for_date", from)
    .order("planned_start_at", { ascending: true, nullsFirst: true });
  useDriverStore.getState().setJobs((jobs ?? []) as unknown as JobWithStops[]);
}

const MIN_INTERVAL_MS = 30_000;
const MIN_MOVE_KM = 0.05;

// Geofence radius for automatic arrival confirmation (~120 m).
const ARRIVAL_RADIUS_KM = 0.12;
const arrivingStops = new Set<string>();

async function autoArriveNearby(driverId: string, p: GPSPosition) {
  const jobs = useDriverStore.getState().jobs;
  const candidates: { jobId: string; stopId: string }[] = [];
  for (const job of jobs) {
    if (["COMPLETED", "CANCELLED", "PENDING"].includes(job.status)) continue;
    const sorted = [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq);
    const nextStop = sorted.find((s) => !s.arrived_at);
    if (!nextStop?.warehouse) continue;
    const wh = nextStop.warehouse;
    const dist = haversineKm(p.lat, p.lon, wh.latitude, wh.longitude);
    if (dist <= ARRIVAL_RADIUS_KM && !arrivingStops.has(nextStop.id)) {
      candidates.push({ jobId: job.id, stopId: nextStop.id });
    }
  }
  for (const c of candidates) {
    arrivingStops.add(c.stopId);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("job_stops")
      .update({ arrived_at: now } as never)
      .eq("id", c.stopId)
      .is("arrived_at", null);
    if (error) {
      arrivingStops.delete(c.stopId);
      continue;
    }
    await supabase
      .from("driver_events")
      .insert({ driver_id: driverId, type: "ARRIVED", payload: { stop_id: c.stopId, auto: true } } as never);
    useDriverStore.getState().setJobs(
      useDriverStore.getState().jobs.map((j) =>
        j.id !== c.jobId
          ? j
          : { ...j, stops: j.stops.map((s) => (s.id === c.stopId ? { ...s, arrived_at: now } : s)) },
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
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setSession(session);
      if (session?.user) {
        loadDriver(session.user.id);
      } else {
        useDriverStore.getState().reset();
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadDriver(data.session.user.id);
    });

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const onPosition = (p: GPSPosition) => {
      setGpsPosition(p);
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
      supabase.from("driver_positions").insert({ driver_id: driver.id, lat: p.lat, lon: p.lon }).then(() => {});
      supabase.from("drivers").update({ current_lat: p.lat, current_lon: p.lon, last_update_time: now }).eq("id", driver.id).then(() => {});
    };

    const startWatch = () => {
      if (stopWatchRef.current) return;
      stopWatchRef.current = watchPosition(onPosition);
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
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } };
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
          () => {},
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Heartbeat — force a fresh position every 60 s. Re-runs even when the
    // page is in the background on browsers that still allow it (most
    // mobile Chrome installs do, iOS Safari throttles harder).
    heartbeatRef.current = setInterval(() => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          onPosition({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            ts: pos.timestamp,
          }),
        () => {},
        { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 },
      );
    }, 60_000);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      stopWatchRef.current?.();
      stopWatchRef.current = null;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [setSession, setOnline, setGpsPosition]);

  const driverId = useDriverStore((s) => s.driver?.id);
  useEffect(() => {
    if (!driverId) return;
    const ch = supabase
      .channel(`driver-${driverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `assigned_driver_id=eq.${driverId}` }, () => refreshJobs(driverId))
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `planned_driver_id=eq.${driverId}` }, () => refreshJobs(driverId))
      .on("postgres_changes", { event: "*", schema: "public", table: "job_stops" }, () => refreshJobs(driverId))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [driverId]);
}
