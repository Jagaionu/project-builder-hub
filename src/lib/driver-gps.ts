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

// Ping cadence — battery-friendly. watchPosition was firing every few seconds
// and burning battery + DB writes; setInterval(5 min) is the dispatcher
// resolution we actually need.
export const GPS_PING_INTERVAL_MS = 5 * 60_000;

/**
 * Polls GPS once per `GPS_PING_INTERVAL_MS` (default 5 min) instead of using
 * `watchPosition`. Fires immediately on start, then on each interval tick,
 * and again whenever the tab becomes visible after being hidden.
 * Returns a cleanup function.
 */
export function watchPosition(cb: (p: GPSPosition) => void): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) return () => {};

  let cancelled = false;
  const pingOnce = () => {
    if (cancelled) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        cb({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: pos.timestamp,
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  };

  // Initial ping + interval.
  pingOnce();
  const intervalId = setInterval(pingOnce, GPS_PING_INTERVAL_MS);

  // Extra ping when the tab returns to foreground (mobile browsers often
  // throttle background timers).
  const onVis = () => {
    if (document.visibilityState === "visible") pingOnce();
  };
  document.addEventListener("visibilitychange", onVis);

  return () => {
    cancelled = true;
    clearInterval(intervalId);
    document.removeEventListener("visibilitychange", onVis);
  };
}
