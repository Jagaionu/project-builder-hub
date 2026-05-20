// Haversine distance in km
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Transit time model: first 12.87 km at city speed (16.09 km/h),
// remainder at highway speed (64.37 km/h).
export const CITY_SPEED_KMH = 16.09;
export const HIGHWAY_SPEED_KMH = 64.37;
export const CITY_DISTANCE_KM = 12.87;

export function transitTimeHours(distanceKm: number) {
  if (distanceKm <= 0) return 0;
  if (distanceKm <= CITY_DISTANCE_KM) return distanceKm / CITY_SPEED_KMH;
  return (
    CITY_DISTANCE_KM / CITY_SPEED_KMH +
    (distanceKm - CITY_DISTANCE_KM) / HIGHWAY_SPEED_KMH
  );
}

export function etaMinutes(distanceKm: number) {
  return Math.round(transitTimeHours(distanceKm) * 60);
}

// Default loading/unloading dwell time at a warehouse, in minutes.
export const LOADING_MINUTES = 30;

export const GEOFENCE_RADIUS_M = 300;
export function isInsideGeofence(driverLat: number, driverLon: number, whLat: number, whLon: number) {
  return haversineKm(driverLat, driverLon, whLat, whLon) * 1000 <= GEOFENCE_RADIUS_M;
}

// Compute the leg duration in minutes between two warehouse points,
// optionally including loading time at the FROM stop if it's a PICKUP.
export type StopLike = { kind: "PICKUP" | "DROP"; warehouse_id: string };
export type WhLike = { id: string; latitude: number; longitude: number };

export function legMinutes(
  fromStop: StopLike,
  fromWh: WhLike,
  toWh: WhLike,
): { transitMin: number; loadingMin: number; totalMin: number; km: number } {
  const km = haversineKm(fromWh.latitude, fromWh.longitude, toWh.latitude, toWh.longitude);
  const transitMin = Math.round(transitTimeHours(km) * 60);
  const loadingMin = fromStop.kind === "PICKUP" ? LOADING_MINUTES : 0;
  return { transitMin, loadingMin, totalMin: transitMin + loadingMin, km };
}

// Given a job start time + the ordered stops, compute scheduled_at for each
// stop. First stop = jobStart. Each next stop = previous + loading (if prev
// was a PICKUP) + driving time between the two warehouses.
export function computeStopSchedule(
  stops: StopLike[],
  jobStart: string | Date | null | undefined,
  warehouses: WhLike[],
): (string | null)[] {
  if (!jobStart || stops.length === 0) return stops.map(() => null);
  const out: (string | null)[] = [];
  let t = new Date(jobStart).getTime();
  if (Number.isNaN(t)) return stops.map(() => null);
  for (let i = 0; i < stops.length; i++) {
    if (i === 0) {
      out.push(new Date(t).toISOString());
      continue;
    }
    const prev = warehouses.find((w) => w.id === stops[i - 1].warehouse_id);
    const curr = warehouses.find((w) => w.id === stops[i].warehouse_id);
    if (!prev || !curr) { out.push(null); continue; }
    const leg = legMinutes(stops[i - 1], prev, curr);
    t += leg.totalMin * 60_000;
    out.push(new Date(t).toISOString());
  }
  return out;
}
