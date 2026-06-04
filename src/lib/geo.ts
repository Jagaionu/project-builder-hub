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
export const CITY_SPEED_KMH = 26;
export const HIGHWAY_SPEED_KMH = 88;
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

// Dwell-time model. We assume the driver:
//  - takes 30 min to load at a pickup, plus 15 min of paperwork/checks
//  - takes 30 min to unload at a drop,  plus 15 min of paperwork/checks
//  - adds a 5 min buffer per transit leg (traffic / parking / approach)
export const DEFAULT_HANDLING_MINUTES = 20;
export const LOADING_MINUTES = 20;
export const UNLOADING_MINUTES = 20;
export const CHECKS_MINUTES = 0;
export const ARRIVAL_BUFFER_MINUTES = 5;

export function stopDwellMinutes(kind: "PICKUP" | "DROP", handlingMin?: number): number {
  if (handlingMin != null) return handlingMin;
  return (kind === "PICKUP" ? LOADING_MINUTES : UNLOADING_MINUTES) + CHECKS_MINUTES;
}

export const GEOFENCE_RADIUS_M = 300;
export function isInsideGeofence(driverLat: number, driverLon: number, whLat: number, whLon: number) {
  return haversineKm(driverLat, driverLon, whLat, whLon) * 1000 <= GEOFENCE_RADIUS_M;
}

// Compute the leg duration in minutes between two warehouse points,
// including dwell time at the FROM stop and a small arrival buffer.
export type StopLike = { kind: "PICKUP" | "DROP"; warehouse_id: string };
export type WhLike = { id: string; latitude: number; longitude: number };

export function legMinutes(
  fromStop: StopLike,
  fromWh: WhLike,
  toWh: WhLike,
  handlingMin?: number,
): { transitMin: number; loadingMin: number; totalMin: number; km: number } {
  const km = haversineKm(fromWh.latitude, fromWh.longitude, toWh.latitude, toWh.longitude);
  const transitMin = Math.round(transitTimeHours(km) * 60) + ARRIVAL_BUFFER_MINUTES;
  const loadingMin = stopDwellMinutes(fromStop.kind, handlingMin);
  return { transitMin, loadingMin, totalMin: transitMin + loadingMin, km };
}

// Given a job start time + the ordered stops, compute scheduled_at for each
// stop. First stop = jobStart. Each next stop = previous arrival
// + dwell at previous (load/unload + checks) + transit (incl. buffer).
export function computeStopSchedule(
  stops: StopLike[],
  jobStart: string | Date | null | undefined,
  warehouses: WhLike[],
  handlingMin?: number,
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
    const leg = legMinutes(stops[i - 1], prev, curr, handlingMin);
    t += leg.totalMin * 60_000;
    out.push(new Date(t).toISOString());
  }
  return out;
}

// Total minutes a driver is occupied by a job, from arrival at the first
// stop through to "good to go" after checks at the final stop.
export function jobTotalMinutes(stops: StopLike[], warehouses: WhLike[], handlingMin?: number): number {
  if (stops.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = warehouses.find((w) => w.id === stops[i].warehouse_id);
    const b = warehouses.find((w) => w.id === stops[i + 1].warehouse_id);
    if (!a || !b) continue;
    total += legMinutes(stops[i], a, b, handlingMin).totalMin;
  }
  // Dwell at the final stop (unload + checks) so the driver is "free".
  total += stopDwellMinutes(stops[stops.length - 1].kind, handlingMin);
  return total;
}

// Project where a driver should be along a job timeline at `nowMs`, given the
// job started at `startMs`. Returns the warehouse the driver is at (or heading
// to next) and the phase. Used for predictive position when no GPS ping is
// available — safer than asking drivers to use their phone while driving.
export type ProjectedPosition = {
  phase: "BEFORE_START" | "EN_ROUTE" | "AT_STOP" | "COMPLETED";
  stopIndex: number; // 0-based index of the current/next stop
  minutesUntilNextEvent: number;
};

export function projectPosition(
  stops: StopLike[],
  warehouses: WhLike[],
  startMs: number,
  nowMs: number,
): ProjectedPosition | null {
  if (stops.length === 0) return null;
  if (nowMs < startMs) {
    return { phase: "BEFORE_START", stopIndex: 0, minutesUntilNextEvent: Math.round((startMs - nowMs) / 60_000) };
  }
  // Add an initial arrival buffer to reach the first stop.
  let cursor = startMs + ARRIVAL_BUFFER_MINUTES * 60_000;
  if (nowMs < cursor) {
    return { phase: "EN_ROUTE", stopIndex: 0, minutesUntilNextEvent: Math.round((cursor - nowMs) / 60_000) };
  }
  for (let i = 0; i < stops.length; i++) {
    const dwell = stopDwellMinutes(stops[i].kind) * 60_000;
    if (nowMs < cursor + dwell) {
      return { phase: "AT_STOP", stopIndex: i, minutesUntilNextEvent: Math.round((cursor + dwell - nowMs) / 60_000) };
    }
    cursor += dwell;
    if (i === stops.length - 1) break;
    const a = warehouses.find((w) => w.id === stops[i].warehouse_id);
    const b = warehouses.find((w) => w.id === stops[i + 1].warehouse_id);
    if (!a || !b) continue;
    const transit = (Math.round(transitTimeHours(haversineKm(a.latitude, a.longitude, b.latitude, b.longitude)) * 60) + ARRIVAL_BUFFER_MINUTES) * 60_000;
    if (nowMs < cursor + transit) {
      return { phase: "EN_ROUTE", stopIndex: i + 1, minutesUntilNextEvent: Math.round((cursor + transit - nowMs) / 60_000) };
    }
    cursor += transit;
  }
  return { phase: "COMPLETED", stopIndex: stops.length - 1, minutesUntilNextEvent: 0 };
}
