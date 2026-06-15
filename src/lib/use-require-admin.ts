import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTenant } from "@/lib/tenant-context";

// Render-gate for admin-only tabs (Events, Billing, Team). Redirects non-admins
// to the home route and returns whether the caller may view the page, so the
// component can `if (!useRequireAdmin()) return null;`.
export function useRequireAdmin(): boolean {
  const { role, isSuperAdmin } = useTenant();
  const navigate = useNavigate();
  const ok = role === "admin" || isSuperAdmin;
  useEffect(() => {
    if (!ok) navigate({ to: "/", replace: true });
  }, [ok, navigate]);
  return ok;
}
