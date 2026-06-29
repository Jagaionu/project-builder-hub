// Pure mapping from a plan tier ("level") to the entitlements applied to a
// company's config (modules, limits, branding). The orchestrator merges the
// result into companies.config when a plan change is applied. Kept pure and
// data-driven so it is exhaustively testable and easy to tune.

import type { PlanTier } from "./types";

export type TenantModule =
  | "dispatch"
  | "jobs"
  | "drivers"
  | "warehouses"
  | "alerts"
  | "events"
  | "maps"
  | "ai_agent";

export interface PlanEntitlements {
  modules: TenantModule[];
  /** Office logins (admin + member seats). Drivers are capped by maxDrivers. */
  maxSeats: number;
  maxDrivers: number;
  maxWarehouses: number;
  customBranding: boolean;
}

const CORE_MODULES: TenantModule[] = [
  "dispatch",
  "jobs",
  "drivers",
  "warehouses",
  "alerts",
  "events",
];

export const PLAN_ENTITLEMENTS: Record<PlanTier, PlanEntitlements> = {
  starter: {
    modules: [...CORE_MODULES],
    maxSeats: 3,
    maxDrivers: 20,
    maxWarehouses: 5,
    customBranding: false,
  },
  pro: {
    modules: [...CORE_MODULES, "maps"],
    maxSeats: 10,
    maxDrivers: 50,
    maxWarehouses: 20,
    customBranding: false,
  },
  enterprise: {
    modules: [...CORE_MODULES, "maps", "ai_agent"],
    maxSeats: 50,
    maxDrivers: 500,
    maxWarehouses: 100,
    customBranding: true,
  },
};

/** Entitlements for a plan. Throws on an unknown plan so callers fail loudly. */
export function entitlementsForPlan(plan: PlanTier): PlanEntitlements {
  const e = PLAN_ENTITLEMENTS[plan];
  if (!e) throw new Error(`Unknown plan: ${plan}`);
  // Return copies so callers can't mutate the shared definition.
  return { ...e, modules: [...e.modules] };
}
