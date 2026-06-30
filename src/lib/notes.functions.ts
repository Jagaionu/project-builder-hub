// Driver-side route notes: a driver can add/read notes on a job they are
// assigned to, stored in the SAME route_notes table the dispatcher reads, so a
// driver's comment shows up on the VRID's notes. Validated server-side (the
// driver must be the assigned/planned driver) and run via the service role.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

async function driverForUser(userId: string) {
  const { data } = await sb
    .from("drivers")
    .select("id, name")
    .eq("user_id", userId)
    .maybeSingle();
  return data as { id: string; name: string | null } | null;
}

async function assertAssigned(jobId: string, driverId: string) {
  const { data: job } = await sb
    .from("jobs")
    .select("id, tenant_id, assigned_driver_id, planned_driver_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) throw new Error("Route not found");
  if (job.assigned_driver_id !== driverId && job.planned_driver_id !== driverId) {
    throw new Error("Not your route");
  }
  return job as { id: string; tenant_id: string | null };
}

export const addDriverRouteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const driver = await driverForUser(context.userId);
    if (!driver) throw new Error("Driver not found");
    const job = await assertAssigned(data.jobId, driver.id);
    const { error } = await sb.from("route_notes").insert({
      job_id: data.jobId,
      tenant_id: job.tenant_id,
      body: data.body,
      author_user_id: context.userId,
      author_name: driver.name ?? "Driver",
      author_email: null,
      author_avatar_url: null,
      visible_to_drivers: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDriverRouteNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const driver = await driverForUser(context.userId);
    if (!driver) return [];
    const { data: job } = await sb
      .from("jobs")
      .select("assigned_driver_id, planned_driver_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || (job.assigned_driver_id !== driver.id && job.planned_driver_id !== driver.id)) {
      return [];
    }
    // Notes the driver may see: anything marked visible-to-drivers, plus their own.
    const { data: notes } = await sb
      .from("route_notes")
      .select("id, body, created_at, author_name, author_user_id, visible_to_drivers")
      .eq("job_id", data.jobId)
      .or("visible_to_drivers.eq.true,author_user_id.eq." + context.userId)
      .order("created_at", { ascending: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((notes ?? []) as Array<any>).map((n) => ({
      id: n.id as string,
      body: n.body as string,
      created_at: n.created_at as string,
      author_name: (n.author_name ?? null) as string | null,
      mine: n.author_user_id === context.userId,
    }));
  });
