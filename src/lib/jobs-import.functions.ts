import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";
import { logActivityServer } from "@/lib/activity-log.server";

export type ImportRow = {
  reference: string;          // Load #
  lane: string;               // e.g. "BZDN->SWA_FR_GRAVUREE->CDG8"
  equipmentType: string | null;
  estimatedCost?: string | null;
  // Per-stop arrival ISO strings (already parsed client-side from
  // Scheduled Truck Arrival - N date/time). length matches stops in lane.
  stopScheduledAt: (string | null)[];
  // Per-stop yard departure ISO strings (FMC bulk upload only). Same length as
  // stopScheduledAt; entries may be null.
  stopYardDeparture?: (string | null)[];
};

export type ImportBatchSummary = {
  id: string;
  file_name: string;
  row_count: number;
  created_count: number;
  parked_count: number;
  duplicate_count: number;
  error_count: number;
  created_at: string;
  expires_at: string;
};

export type ImportResult = {
  created: number;
  parked: string[];
  skippedDuplicate: string[];
  skippedUnknownWh: { reference: string; missing: string[] }[];
  errors: { reference: string; message: string }[];
  batchId: string | null;
};

export const importJobsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rows: ImportRow[]; fileName: string }) => input)
  .handler(async ({ data, context }): Promise<ImportResult> => {
    const { userId } = context;
    const superAdmin = await isSuperAdmin(userId);
    const tenantId = await getUserTenantId(userId);
    if (!superAdmin && !tenantId) throw new Error("Forbidden");
    const out: ImportResult = {
      created: 0,
      parked: [],
      skippedDuplicate: [],
      skippedUnknownWh: [],
      errors: [],
      batchId: null,
    };

    // Create the import batch record upfront so we can link rows to it.
    let batchId: string | null = null;
    if (tenantId) {
      const { data: batch, error: batchErr } = await supabaseAdmin
        .from("import_batches" as never)
        .insert({
          tenant_id: tenantId,
          file_name: data.fileName,
          row_count: data.rows.length,
          csv_rows: data.rows,
        } as never)
        .select("id")
        .single();
      if (!batchErr && batch) {
        batchId = (batch as { id: string }).id;
        out.batchId = batchId;
      }
    }

    // Pre-fetch existing parked refs to dedupe against
    const { data: parkedExisting } = await supabaseAdmin
      .from("pending_job_imports" as never)
      .select("reference")
      .eq("tenant_id", tenantId as never);
    const parkedRefs = new Set(
      ((parkedExisting ?? []) as { reference: string }[]).map((r) => r.reference),
    );

    // Pre-fetch existing reimport alert refs (so we can upsert not multi-insert)
    const { data: reimportExisting } = await supabaseAdmin
      .from("reimport_alerts" as never)
      .select("reference")
      .eq("tenant_id", tenantId as never);
    const reimportRefs = new Set(
      ((reimportExisting ?? []) as { reference: string }[]).map((r) => r.reference),
    );

    // Pre-fetch warehouses visible to this tenant:
    //   1. Global warehouses (tenant_id IS NULL) – shared across all companies
    //   2. Tenant-specific warehouses for the current tenant
    // Load globals first, then tenant-specific so tenant-specific overwrites
    // when the same code exists in both (tenant-specific takes precedence).
    const { data: globalWhs } = await supabaseAdmin
      .from("warehouses")
      .select("id,code")
      .is("tenant_id", null);
    const { data: tenantWhs } = await supabaseAdmin
      .from("warehouses")
      .select("id,code")
      .eq("tenant_id", tenantId as never);
    const whMap = new Map<string, string>();
    for (const w of (globalWhs ?? []) as { id: string; code: string }[]) {
      whMap.set(w.code.toUpperCase(), w.id);
    }
    for (const w of (tenantWhs ?? []) as { id: string; code: string }[]) {
      whMap.set(w.code.toUpperCase(), w.id); // tenant-specific wins
    }

    // Pre-fetch existing references
    const refs = data.rows.map((r) => r.reference).filter(Boolean);
    const { data: existing } = await supabaseAdmin
      .from("jobs")
      .select("reference")
      .in("reference", refs.length ? refs : [""]);
    const existingRefs = new Set(
      ((existing ?? []) as { reference: string }[]).map((j) => j.reference),
    );

    for (const row of data.rows) {
      try {
        if (!row.reference) {
          out.errors.push({ reference: "(blank)", message: "Missing Load #" });
          continue;
        }
        if (existingRefs.has(row.reference)) {
          // Surface the re-upload as an alert instead of silently discarding.
          // Upsert so repeated re-uploads update the lane and timestamp rather
          // than stacking duplicate rows.
          if (reimportRefs.has(row.reference)) {
            await supabaseAdmin
              .from("reimport_alerts" as never)
              .update({ lane: row.lane, uploaded_at: new Date().toISOString() } as never)
              .eq("tenant_id", tenantId as never)
              .eq("reference", row.reference);
          } else {
            await supabaseAdmin
              .from("reimport_alerts" as never)
              .insert({
                tenant_id: tenantId,
                reference: row.reference,
                lane: row.lane,
              } as never);
            reimportRefs.add(row.reference);
          }
          out.skippedDuplicate.push(row.reference);
          continue;
        }
        const codes = row.lane.split("->").map((c) => c.trim()).filter(Boolean);
        if (codes.length < 2) {
          out.errors.push({ reference: row.reference, message: `Lane needs >=2 stops, got "${row.lane}"` });
          continue;
        }
        const stopWhIds: string[] = [];
        const missing: string[] = [];
        for (const c of codes) {
          const id = whMap.get(c.toUpperCase());
          if (!id) missing.push(c);
          else stopWhIds.push(id);
        }
        if (missing.length) {
          // Park the row so it appears in Alerts; auto-promotes when WH is added.
          if (parkedRefs.has(row.reference)) {
            // Refresh missing_codes in case some have since been added by hand.
            await supabaseAdmin
              .from("pending_job_imports" as never)
              .update({
                lane: row.lane,
                equipment_type: row.equipmentType,
                stop_scheduled_at: row.stopScheduledAt,
                missing_codes: missing,
              } as never)
              .eq("tenant_id", tenantId as never)
              .eq("reference", row.reference);
          } else {
            const { error: parkErr } = await supabaseAdmin
              .from("pending_job_imports" as never)
              .insert({
                tenant_id: tenantId,
                reference: row.reference,
                lane: row.lane,
                equipment_type: row.equipmentType,
                stop_scheduled_at: row.stopScheduledAt,
                missing_codes: missing,
                ...(batchId ? { import_batch_id: batchId } : {}),
              } as never);
            if (parkErr) {
              out.errors.push({ reference: row.reference, message: `park: ${parkErr.message}` });
              continue;
            }
            parkedRefs.add(row.reference);
          }
          out.parked.push(row.reference);
          out.skippedUnknownWh.push({ reference: row.reference, missing });
          continue;
        }


        const firstScheduled = row.stopScheduledAt.find((s) => s) ?? null;

        const { data: job, error: jobErr } = await supabaseAdmin
          .from("jobs")
          .insert({
            reference: row.reference,
            status: "PENDING",
            origin_warehouse_id: stopWhIds[0],
            destination_warehouse_id: stopWhIds[stopWhIds.length - 1],
            scheduled_at: firstScheduled,
            estimated_cost: row.estimatedCost ?? null,
            // for_date is set automatically by the sync_job_for_date trigger
            // from the first stop's scheduled arrival.
            equipment_type: row.equipmentType,
            tenant_id: tenantId,
            ...(batchId ? { import_batch_id: batchId } : {}),
          } as never)
          .select("id")
          .single();
        if (jobErr || !job) {
          out.errors.push({ reference: row.reference, message: jobErr?.message ?? "insert failed" });
          continue;
        }

        const stopsPayload = stopWhIds.map((wid, i) => ({
          job_id: job.id,
          seq: i + 1,
          kind: (i === stopWhIds.length - 1 ? "DROP" : "PICKUP") as "PICKUP" | "DROP",
          warehouse_id: wid,
          scheduled_at: row.stopScheduledAt[i] ?? null,
          yard_departure: row.stopYardDeparture?.[i] ?? null,
        }));
        const { error: stopsErr } = await supabaseAdmin.from("job_stops").insert(stopsPayload as never);
        if (stopsErr) {
          out.errors.push({ reference: row.reference, message: `stops: ${stopsErr.message}` });
          continue;
        }
        out.created++;
        existingRefs.add(row.reference);
      } catch (e) {
        out.errors.push({
          reference: row.reference || "(unknown)",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Update batch with final counts so the Events page shows accurate stats.
    if (batchId) {
      await supabaseAdmin
        .from("import_batches" as never)
        .update({
          created_count:   out.created,
          parked_count:    out.parked.length,
          duplicate_count: out.skippedDuplicate.length,
          error_count:     out.errors.length,
        } as never)
        .eq("id", batchId);
    }

    if (tenantId) {
      const { data: actor } = await (supabaseAdmin as unknown as { from: (t: string) => any })
        .from("company_members").select("name, email").eq("user_id", userId).maybeSingle();
      await logActivityServer({
        tenantId,
        actorUserId: userId,
        actorEmail: actor?.email ?? null,
        actorName: actor?.name ?? null,
        action: "lane.upload",
        entityType: "import",
        entityId: batchId,
        entityRef: data.fileName,
        metadata: { created: out.created, parked: out.parked.length, errors: out.errors.length },
      });
    }

    return out;
  });
