import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";

/**
 * Permanently delete an alert-triggering event or entity upon acknowledgement.
 */
export const ackAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ 
    id: z.string(),
    type: z.enum(["event", "parked"])
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    if (data.type === "event") {
      // For driver_events (DELAYS, CANT_COMPLETE), we delete the event row.
      const { data: ev, error: fetchErr } = await supabaseAdmin
        .from("driver_events")
        .select("id, tenant_id")
        .eq("id", data.id)
        .maybeSingle();
      
      if (fetchErr) throw new Error(fetchErr.message);
      if (!ev) return { ok: true };

      if (!(await isSuperAdmin(userId))) {
        const callerTenant = await getUserTenantId(userId);
        if (!callerTenant || callerTenant !== ev.tenant_id) {
          throw new Error("Forbidden");
        }
      }

      const { error: delErr } = await supabaseAdmin
        .from("driver_events")
        .delete()
        .eq("id", data.id);
      if (delErr) throw new Error(delErr.message);
    } else if (data.type === "parked") {
      // For pending_job_imports, we delete the pending row.
      const { data: p, error: fetchErr } = await supabaseAdmin
        .from("pending_job_imports" as any)
        .select("id, tenant_id")
        .eq("id", data.id)
        .maybeSingle();
      
      if (fetchErr) throw new Error(fetchErr.message);
      if (!p) return { ok: true };

      if (!(await isSuperAdmin(userId))) {
        const callerTenant = await getUserTenantId(userId);
        if (!callerTenant || (p as any).tenant_id && callerTenant !== (p as any).tenant_id) {
          throw new Error("Forbidden");
        }
      }

      const { error: delErr } = await supabaseAdmin
        .from("pending_job_imports" as any)
        .delete()
        .eq("id", data.id);
      if (delErr) throw new Error(delErr.message);
    }

    return { ok: true };
  });
