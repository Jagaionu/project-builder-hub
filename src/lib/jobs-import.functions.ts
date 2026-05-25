import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";

export type ImportRow = {
  reference: string;          // Load #
  lane: string;               // e.g. "BZDN->SWA_FR_GRAVUREE->CDG8"
  equipmentType: string | null;
  // Per-stop arrival ISO strings (already parsed client-side from
  // Scheduled Truck Arrival - N date/time). length matches stops in lane.
  stopScheduledAt: (string | null)[];
};

export type ImportResult = {
  created: number;
  skippedDuplicate: string[];
  skippedUnknownWh: { reference: string; missing: string[] }[];
  errors: { reference: string; message: string }[];
};

export const importJobsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rows: ImportRow[] }) => input)
  .handler(async ({ data, context }): Promise<ImportResult> => {
    const { userId } = context;
    const superAdmin = await isSuperAdmin(userId);
    const tenantId = await getUserTenantId(userId);
    if (!superAdmin && !tenantId) throw new Error("Forbidden");
    const out: ImportResult = {
      created: 0,
      skippedDuplicate: [],
      skippedUnknownWh: [],
      errors: [],
    };

    // Pre-fetch warehouses
    const { data: whs } = await supabaseAdmin
      .from("warehouses")
      .select("id,code");
    const whMap = new Map<string, string>();
    for (const w of (whs ?? []) as { id: string; code: string }[]) {
      whMap.set(w.code.toUpperCase(), w.id);
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
            // for_date is set automatically by the sync_job_for_date trigger
            // from the first stop's scheduled arrival.
            equipment_type: row.equipmentType,
            tenant_id: tenantId,
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
        }));
        const { error: stopsErr } = await supabaseAdmin.from("job_stops").insert(stopsPayload);
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
    return out;
  });
