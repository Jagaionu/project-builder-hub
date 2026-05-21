import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  recomputeRecent,
  recomputeAllRecent,
  backfillAll,
} from "@/lib/shift-ledger.server";

export const recomputeShiftLedger = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ driverId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    await recomputeRecent(data.driverId);
    return { ok: true };
  });

export const recomputeAllShiftLedger = createServerFn({ method: "POST" })
  .handler(async () => {
    return recomputeAllRecent(2);
  });

export const backfillShiftLedger = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ days: z.number().int().min(1).max(60).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    return backfillAll(data.days ?? 21);
  });
