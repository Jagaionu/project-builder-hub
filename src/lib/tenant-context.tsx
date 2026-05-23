import { createContext, useContext, type ReactNode } from "react";
import type { AuthContext as AuthCtx, TenantConfig } from "@/lib/types";
import { DEFAULT_TENANT_CONFIG } from "@/lib/types";

const TenantContext = createContext<AuthCtx | null>(null);

interface TenantProviderProps {
  value: AuthCtx;
  children: ReactNode;
}

export function TenantProvider({ value, children }: TenantProviderProps) {
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): AuthCtx {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used inside TenantProvider (authenticated routes only)");
  }
  return ctx;
}

export function useFeatureFlags(): TenantConfig {
  const { company } = useTenant();
  return { ...DEFAULT_TENANT_CONFIG, ...company.config };
}

export function useHasModule(module: TenantConfig["modules"][number]): boolean {
  const flags = useFeatureFlags();
  return flags.modules.includes(module);
}
