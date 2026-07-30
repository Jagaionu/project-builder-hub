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
  /** FK → warehouses.id. The depot this driver operates from. Null = free agent (no fixed base). */
  home_warehouse_id: string | null;
  /** When true the planner must route this driver back to home_warehouse_id at end of day. */
  return_to_base_required: boolean;
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
  equipment_type?: string | null;
  estimated_cost?: string | null;
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
export type TenantModule =
  | "dispatch"
  | "jobs"
  | "drivers"
  | "warehouses"
  | "alerts"
  | "events"
  | "maps"
  | "ai_agent";

export interface TenantConfig {
  modules: TenantModule[];
  maxDrivers: number;
  maxWarehouses: number;
  showComplianceModule: boolean;
  customBranding: boolean;
  brandName: string | null;
  brandColor: string | null;
  /** Per-company price overrides (net minor units, excl. VAT). null = use the
   *  plan default from plan_prices. Set by a super admin per company. */
  priceMonthlyMinor?: number | null;
  priceAnnualMinor?: number | null;
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
  verification_status?: string | null;
  verification_method?: string | null;
  company_number?: string | null;
  company_house_name?: string | null;
  director_name?: string | null;
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
  name?: string | null;
  mustSetPassword?: boolean;
  avatarUrl?: string | null;
  verificationStatus?: string | null;
}

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  modules: ["dispatch", "jobs", "drivers", "warehouses", "alerts", "events", "maps", "ai_agent"],
  maxDrivers: 20,
  maxWarehouses: 5,
  showComplianceModule: true,
  customBranding: false,
  brandName: null,
  brandColor: null,
  priceMonthlyMinor: null,
  priceAnnualMinor: null,
};

// Aggregated weekly availability for a driver, derived from the per-day
// driver_shift_templates rows. days_of_week is the set of weekdays the driver
// works (0=Sun..6=Sat). shiftByDay provides per-day start/end times so the
// planner can use the real shift window instead of a hardcoded 06:00 default.
// One entry per working day — single shift per day is enforced by uq_driver_day.
export interface DriverShift {
  id: string;
  driver_id: string;
  days_of_week: number[]; // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  /** Keyed by day_of_week (0–6). Present only for working days; a day with
   *  null start/end times means "available that day, no fixed hours" — the
   *  planner applies compliance limits but no shift-end cap. */
  shiftByDay: Record<number, { start_time: string | null; end_time: string | null }>;
  created_at: string;
  updated_at: string;
}

// One row per (driver, day_of_week) in driver_shift_templates.
// Single shift per day is enforced by the uq_driver_day unique constraint.
export interface DriverShiftTemplate {
  id: string;
  tenant_id: string | null;
  driver_id: string;
  day_of_week: number; // 0=Sun..6=Sat
  start_time: string | null; // "HH:MM[:SS]" or null = no fixed start (available all day)
  end_time: string | null; // "HH:MM[:SS]" or null = no fixed end; end < start = crosses midnight
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface DriverAvailabilityOverride {
  id: string;
  driver_id: string;
  date: string; // YYYY-MM-DD
  available: boolean;
  set_by: "driver" | "planner";
  created_at: string;
}
