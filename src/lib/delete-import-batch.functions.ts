import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";
import { logActivityServer } from "@/lib/activity-log.server";

/**
 * Delete an import batch and all jobs created from it.
 * Deleting the batch cascades to:
 *   • jobs (via import_batch_id FK ON DELETE CASCADE)
 *     → job_stops (via job_id FK ON DELETE CASCADE)
 *   • pending_job_imports (via import_batch_id FK ON DELETE CASCADE)
 */
export const deleteImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ batchId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const superAdmin = await isSuperAdmin(userId);

    // Fetch the batch to verify ownership.
    const { data: batch, error: fetchErr } = await supabaseAdmin
      .from("import_batches" as never)
      .select("id, tenant_id, file_name")
      .eq("id", data.batchId)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!batch) return { ok: true, deleted: 0 }; // already gone

    if (!superAdmin) {
      const callerTenant = await getUserTenantId(userId);
      if (!callerTenant || callerTenant !== (batch as { tenant_id: string }).tenant_id) {
        throw new Error("Forbidden");
      }
    }

    // Count how many jobs will be deleted so we can report it.
    const { count } = await supabaseAdmin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id" as never, data.batchId);

    // Delete — cascade handles jobs, job_stops, pending_job_imports.
    const { error: delErr } = await supabaseAdmin
      .from("import_batches" as never)
      .delete()
      .eq("id", data.batchId);

    if (delErr) throw new Error(delErr.message);

    const { data: actor } = await (supabaseAdmin as unknown as { from: (t: string) => any })
      .from("company_members")
      .select("name, email")
      .eq("user_id", userId)
      .maybeSingle();
    await logActivityServer({
      tenantId: (batch as { tenant_id: string }).tenant_id,
      actorUserId: userId,
      actorEmail: actor?.email ?? null,
      actorName: actor?.name ?? null,
      action: "import.delete",
      entityType: "import",
      entityId: data.batchId,
      entityRef: (batch as { file_name: string }).file_name,
      metadata: { deleted: count ?? 0 },
    });

    return { ok: true, deleted: count ?? 0 };
  });
