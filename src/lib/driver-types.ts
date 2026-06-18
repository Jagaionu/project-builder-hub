// Driver app types. Mirrors the dispatch DB schema (assigned_driver_id, job_stops).
export type DriverStatus = "AVAILABLE" | "ON_SHIFT" | "ON_ROUTE" | "OFF_SHIFT" | "DELAYED";
export type JobStatus =
  | "PENDING"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "ARRIVED_PICKUP"
  | "EN_ROUTE_DELIVERY"
  | "COMPLETED"
  | "CANCELLED";
export type StopKind = "PICKUP" | "DROP";

export interface DriverWarehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
}

export interface DriverProfile {
  id: string;
  user_id: string | null;
  name: string;
  status: DriverStatus;
  last_update_time: string | null;
  current_lat: number | null;
  current_lon: number | null;
  /** FK → warehouses.id. Null = free agent (no fixed base). */
  home_warehouse_id: string | null;
  /** When true the planner must route this driver back to home_warehouse_id at end of day. */
  return_to_base_required: boolean;
  /** When true the driver app is blocked. */
  suspended?: boolean | null;
  /** ISO timestamp the suspension lasts until; null = indefinite. */
  suspended_until?: string | null;
  suspended_reason?: string | null;
}

export interface DriverStop {
  id: string;
  job_id: string;
  warehouse_id: string;
  kind: StopKind;
  seq: number;
  arrived_at: string | null;
  scheduled_at: string | null;
  warehouse?: DriverWarehouse;
}

export interface DriverJob {
  id: string;
  reference: string;
  status: JobStatus;
  for_date: string | null;
  planned_start_at: string | null;
  scheduled_at: string | null;
  assigned_driver_id: string | null;
  planned_driver_id: string | null;
}

export interface JobWithStops extends DriverJob {
  stops: DriverStop[];
}
