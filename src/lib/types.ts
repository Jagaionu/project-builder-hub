export type DriverStatus = "AVAILABLE" | "ON_SHIFT" | "ON_ROUTE" | "DELAYED" | "OFF_SHIFT";
export type JobStatus =
  | "PENDING"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "ARRIVED_PICKUP"
  | "EN_ROUTE_DELIVERY"
  | "COMPLETED"
  | "CANCELLED";

export interface Driver {
  id: string;
  name: string;
  phone: string | null;
  telegram_id: string | null;
  current_lat: number | null;
  current_lon: number | null;
  status: DriverStatus;
  last_update_time: string | null;
  created_at: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
}

export interface Job {
  id: string;
  reference: string;
  origin_warehouse_id: string;
  destination_warehouse_id: string;
  assigned_driver_id: string | null;
  status: JobStatus;
  eta_minutes: number | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriverEvent {
  id: string;
  driver_id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
