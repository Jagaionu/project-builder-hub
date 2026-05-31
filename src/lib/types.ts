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
  login_code?: string | null;
  tenant_id?: string | null;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  tenant_id?: string | null;
}

export interface Job {
  id: string;
  reference: string;
  origin_warehouse_id: string | null;
  destination_warehouse_id: string | null;
  assigned_driver_id: string | null;
  status: JobStatus;
  eta_minutes: number | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  planned_driver_id?: string | null;
  planned_sequence?: number | null;
  planned_start_at?: string | null;
  for_date?: string | null;
  manual_override?: boolean;
}


export interface DriverEvent {
  id: string;
  driver_id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ── Tenant / Auth types ──────────────────────────────────────────────────────

export type SubscriptionStatus = "active" | "trial" | "suspended" | "cancelled";
export type CompanyPlan = "starter" | "pro" | "enterprise";
export type MemberRole = "admin" | "member";
export type TenantModule = "dispatch" | "jobs" | "drivers" | "warehouses" | "alerts" | "events" | "maps" | "ai_agent";

export interface TenantConfig {
  modules: TenantModule[];
  maxDrivers: number;
  maxWarehouses: number;
  showComplianceModule: boolean;
  customBranding: boolean;
  brandName: string | null;
  brandColor: string | null;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  subscription_status: SubscriptionStatus;
  subscription_ends_at: string | null;
  plan: CompanyPlan;
  config: TenantConfig;
  created_at: string;
  updated_at: string;
}

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
}

export interface AuthContext {
  userId: string;
  email: string;
  company: Company;
  role: MemberRole;
  isSuperAdmin: boolean;
}

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  modules: ["dispatch", "jobs", "drivers", "warehouses", "alerts", "events", "maps", "ai_agent"],
  maxDrivers: 20,
  maxWarehouses: 5,
  showComplianceModule: true,
  customBranding: false,
  brandName: null,
  brandColor: null,
}

// Aggregated weekly availability for a driver, derived from the per-day
// driver_shift_templates rows. days_of_week is the set of weekdays the driver
// works (0=Sun..6=Sat). This shape is what the planner's availability check
// consumes; the underlying storage is now driver_shift_templates.
export interface DriverShift {
  id: string;
  driver_id: string;
  days_of_week: number[]; // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  created_at: string;
  updated_at: string;
}

// One row per (driver, day_of_week, start_time) in driver_shift_templates.
// Supports split shifts (multiple rows per day) and per-day start/end times.
export interface DriverShiftTemplate {
  id: string;
  tenant_id: string | null;
  driver_id: string;
  day_of_week: number; // 0=Sun..6=Sat
  start_time: string;  // "HH:MM[:SS]"
  end_time: string;    // "HH:MM[:SS]"; end < start = crosses midnight
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface DriverAvailabilityOverride {
  id: string;
  driver_id: string;
  date: string; // YYYY-MM-DD
  available: boolean;
  set_by: 'driver' | 'planner';
  created_at: string;
};

