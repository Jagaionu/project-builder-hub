import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthContext as AuthCtx, TenantConfig } from "@/lib/types";
import { DEFAULT_TENANT_CONFIG } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";

const TenantContext = createContext<AuthCtx | null>(null);

interface TenantProviderProps {
  value: AuthCtx;
  children: ReactNode;
}

export function TenantProvider({ value, children }: TenantProviderProps) {
  // Config is loaded once at sign-in; keep it live so per-company module
  // toggles (e.g. ai_agent) take effect without a hard reload.
  const [config, setConfig] = useState<TenantConfig>(value.company.config);
  useEffect(() => {
    let active = true;
    const id = value.company.id;
    void (async () => {
      const { data } = await supabase.from("companies" as never).select("config").eq("id", id).maybeSingle();
      const next = (data as { config?: TenantConfig } | null)?.config;
      if (active && next) setConfig(next);
    })();
    const ch = supabase
      .channel(`tenant-config-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "companies", filter: `id=eq.${id}` }, (p) => {
        const c = (p.new as { config?: TenantConfig }).config;
        if (active && c) setConfig(c);
      })
      .subscribe();
    return () => { active = false; void supabase.removeChannel(ch); };
  }, [value.company.id]);
  const merged: AuthCtx = { ...value, company: { ...value.company, config } };
  return <TenantContext.Provider value={merged}>{children}</TenantContext.Provider>;
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
