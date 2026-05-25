import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertDriverAccess } from "@/lib/auth-helpers.server";

function ymdUk(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function recomputeDayTotals(driverId: string, day: string) {
  const [{ data: legs }, { data: dwells }] = await Promise.all([
    supabaseAdmin.from("driving_legs" as never).select("driving_minutes,from_warehouse_id").eq("driver_id", driverId).eq("leg_date", day),
    supabaseAdmin.from("stop_dwells" as never).select("dwell_minutes").eq("driver_id", driverId).eq("dwell_date", day),
  ]);
  let drive = 0, dead = 0, other = 0;
  for (const l of (legs ?? []) as Array<{ driving_minutes: number | null; from_warehouse_id: string | null }>) {
    const m = l.driving_minutes ?? 0;
    drive += m;
    if (l.from_warehouse_id == null) dead += m;
  }
  for (const d of (dwells ?? []) as Array<{ dwell_minutes: number | null }>) {
    other += d.dwell_minutes ?? 0;
  }
  await supabaseAdmin.from("driver_day_hours" as never).upsert({
    driver_id: driverId,
    day,
    actual_driving_minutes: drive,
    other_work_minutes: other,
    deadhead_minutes: dead,
    drive_minutes: drive,
  } as never, { onConflict: "driver_id,day" });
}

const OpenLegInput = z.object({
  driverId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  fromWarehouseId: z.string().uuid().nullable(),
  fromLabel: z.string().max(120),
  fromLat: z.number(),
  fromLon: z.number(),
  toWarehouseId: z.string().uuid().nullable(),
  toLabel: z.string().max(120),
  toLat: z.number(),
  toLon: z.number(),
  departedAt: z.string().min(1),
  plannedMinutes: z.number().int().min(0).max(48 * 60),
});

export const openLeg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => OpenLegInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertDriverAccess(context.userId, data.driverId);
    const leg_date = ymdUk(data.departedAt);
    const distance_km = haversineKm(data.fromLat, data.fromLon, data.toLat, data.toLon);
    const { data: row, error } = await supabaseAdmin.from("driving_legs" as never).insert({
      driver_id: data.driverId, job_id: data.jobId, leg_date,
      from_warehouse_id: data.fromWarehouseId, from_label: data.fromLabel,
      from_lat: data.fromLat, from_lon: data.fromLon,
      to_warehouse_id: data.toWarehouseId, to_label: data.toLabel,
      to_lat: data.toLat, to_lon: data.toLon,
      departed_at: data.departedAt, planned_minutes: data.plannedMinutes,
      distance_km, source: "gps",
    } as never).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Failed to open leg");
    return { id: (row as { id: string }).id };
  });

const CloseLegInput = z.object({
  legId: z.string().uuid(),
  arrivedAt: z.string().min(1),
  actualLat: z.number(),
  actualLon: z.number(),
});

export const closeLeg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CloseLegInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: leg } = await supabaseAdmin.from("driving_legs" as never)
      .select("driver_id,leg_date,departed_at").eq("id", data.legId).maybeSingle();
    if (!leg) throw new Error("Leg not found");
    const row = leg as { driver_id: string; leg_date: string; departed_at: string | null };
    await assertDriverAccess(context.userId, row.driver_id);
    const driving_minutes = row.departed_at
      ? Math.max(0, Math.round((new Date(data.arrivedAt).getTime() - new Date(row.departed_at).getTime()) / 60_000))
      : 0;
    await supabaseAdmin.from("driving_legs" as never).update({
      arrived_at: data.arrivedAt, driving_minutes,
    } as never).eq("id", data.legId);
    await recomputeDayTotals(row.driver_id, row.leg_date);
    return { ok: true, driving_minutes };
  });

const OpenDwellInput = z.object({
  driverId: z.string().uuid(),
  jobId: z.string().uuid(),
  jobStopId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  kind: z.enum(["PICKUP", "DROP", "WAIT"]),
  arrivedAt: z.string().min(1),
});

export const openDwell = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => OpenDwellInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertDriverAccess(context.userId, data.driverId);
    const dwell_date = ymdUk(data.arrivedAt);
    const { data: row, error } = await supabaseAdmin.from("stop_dwells" as never).insert({
      driver_id: data.driverId, job_id: data.jobId,
      job_stop_id: data.jobStopId, warehouse_id: data.warehouseId,
      dwell_date, arrived_at: data.arrivedAt, kind: data.kind,
    } as never).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Failed to open dwell");
    return { id: (row as { id: string }).id };
  });

const CloseDwellInput = z.object({
  dwellId: z.string().uuid(),
  departedAt: z.string().min(1),
});

export const closeDwell = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CloseDwellInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: dwell } = await supabaseAdmin.from("stop_dwells" as never)
      .select("driver_id,dwell_date,arrived_at").eq("id", data.dwellId).maybeSingle();
    if (!dwell) throw new Error("Dwell not found");
    const row = dwell as { driver_id: string; dwell_date: string; arrived_at: string | null };
    await assertDriverAccess(context.userId, row.driver_id);
    const dwell_minutes = row.arrived_at
      ? Math.max(0, Math.round((new Date(data.departedAt).getTime() - new Date(row.arrived_at).getTime()) / 60_000))
      : 0;
    await supabaseAdmin.from("stop_dwells" as never).update({
      departed_at: data.departedAt, dwell_minutes,
    } as never).eq("id", data.dwellId);
    await recomputeDayTotals(row.driver_id, row.dwell_date);
    return { ok: true, dwell_minutes };
  });
