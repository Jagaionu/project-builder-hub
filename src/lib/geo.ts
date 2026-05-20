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
