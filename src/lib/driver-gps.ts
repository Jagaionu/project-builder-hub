export interface GPSPosition {
  lat: number;
  lon: number;
  accuracy?: number;
  ts: number;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function etaMinutes(km: number, avgKph = 55): number {
  return Math.round((km / avgKph) * 60);
}

// Anti-cheat: a driver may only confirm arrival / unload when a RECENT GPS fix
// places them at the stop. 200 m radius, fix no older than 3 minutes.
export const ARRIVAL_GEOFENCE_KM = 0.2;
export const GPS_FRESH_MS = 3 * 60_000;
export function atLocation(
  gps: GPSPosition | null,
  lat: number,
  lon: number,
  radiusKm = ARRIVAL_GEOFENCE_KM,
  maxAgeMs = GPS_FRESH_MS,
): boolean {
  if (!gps) return false;
  if (Date.now() - gps.ts > maxAgeMs) return false;
  return haversineKm(gps.lat, gps.lon, lat, lon) <= radiusKm;
}

// Ping cadence — battery-friendly. watchPosition was firing every few seconds
// and burning battery + DB writes; setInterval(5 min) is the dispatcher
// resolution we actually need.
export const GPS_PING_INTERVAL_MS = 5 * 60_000;
// While on an active route we ping far more often so geofenced arrivals and
// departures are actually captured (a 5-min cadence misses short stops).
export const GPS_ACTIVE_PING_INTERVAL_MS = 60_000;

/**
 * Polls GPS once per `GPS_PING_INTERVAL_MS` (default 5 min) instead of using
 * `watchPosition`. Fires immediately on start, then on each interval tick,
 * and again whenever the tab becomes visible after being hidden.
 * Returns a cleanup function.
 */
export function watchPosition(
  cb: (p: GPSPosition) => void,
  onError?: (err: GeolocationPositionError) => void,
  getIntervalMs?: () => number,
): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onError?.({ code: 2, message: "Geolocation is not available" } as GeolocationPositionError);
    return () => {};
  }

  let cancelled = false;
  const onPos = (pos: GeolocationPosition) => {
    if (cancelled) return;
    cb({
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      ts: pos.timestamp,
    });
  };
  const pingOnce = () => {
    if (cancelled) return;
    navigator.geolocation.getCurrentPosition(
      onPos,
      (err) => {
        if (cancelled) return;
        // High-accuracy often times out (indoors / desktop / weak GPS). Retry
        // once at low accuracy before surfacing the error.
        if (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE) {
          navigator.geolocation.getCurrentPosition(onPos, (e2) => onError?.(e2), {
            enableHighAccuracy: false,
            maximumAge: 60_000,
            timeout: 25_000,
          });
        } else {
          onError?.(err);
        }
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  };

  // Initial ping, then a self-scheduling timer whose interval is recomputed each
  // cycle (frequent on an active route, battery-friendly when idle).
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (cancelled) return;
    const ms = Math.max(15_000, getIntervalMs ? getIntervalMs() : GPS_PING_INTERVAL_MS);
    timer = setTimeout(() => {
      pingOnce();
      schedule();
    }, ms);
  };
  pingOnce();
  schedule();

  // Extra ping when the tab returns to foreground (mobile browsers often
  // throttle background timers).
  const onVis = () => {
    if (document.visibilityState === "visible") pingOnce();
  };
  document.addEventListener("visibilitychange", onVis);

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVis);
  };
}
