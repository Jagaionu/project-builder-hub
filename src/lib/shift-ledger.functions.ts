import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  recomputeRecent,
  recomputeAllRecent,
  backfillAll,
  recomputeDriverDay,
} from "@/lib/shift-ledger.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertDriverAccess, isSuperAdmin } from "@/lib/auth-helpers.server";

export const recomputeShiftLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ driverId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertDriverAccess(context.userId, data.driverId);
    await recomputeRecent(data.driverId);
    return { ok: true };
  });

export const recomputeAllShiftLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isSuperAdmin(context.userId))) throw new Error("Forbidden");
    return recomputeAllRecent(2);
  });

export const backfillShiftLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ days: z.number().int().min(1).max(60).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isSuperAdmin(context.userId))) throw new Error("Forbidden");
    return backfillAll(data.days ?? 21);
  });

export const refreshDriverDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ driverId: z.string().uuid(), day: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertDriverAccess(context.userId, data.driverId);
    await recomputeDriverDay(data.driverId, data.day);
    return { ok: true };
  });
