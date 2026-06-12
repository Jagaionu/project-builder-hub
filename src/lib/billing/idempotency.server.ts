// Supabase-backed IdempotencyStore. Uses the UNIQUE(idempotency_key,
// operation_type) constraint on billing_idempotency for atomic reservation.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { IdempotencyStore } from "./idempotency";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

export const supabaseIdempotencyStore: IdempotencyStore = {
  async reserve(key, operation, companyId) {
    const { error } = await sb.from("billing_idempotency").insert({
      idempotency_key: key,
      operation_type: operation,
      company_id: companyId,
      result: null,
    });
    if (!error) return { existing: false };

    // Unique violation => already reserved/completed. Fetch the stored row.
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      const { data } = await sb
        .from("billing_idempotency")
        .select("result")
        .eq("idempotency_key", key)
        .eq("operation_type", operation)
        .maybeSingle();
      return { existing: true, row: { result: data?.result ?? null } };
    }
    throw new Error(error.message ?? "idempotency reserve failed");
  },

  async complete(key, operation, result) {
    const { error } = await sb
      .from("billing_idempotency")
      .update({ result: result ?? null })
      .eq("idempotency_key", key)
      .eq("operation_type", operation);
    if (error) throw new Error(error.message);
  },

  async release(key, operation) {
    await sb
      .from("billing_idempotency")
      .delete()
      .eq("idempotency_key", key)
      .eq("operation_type", operation);
  },
};
