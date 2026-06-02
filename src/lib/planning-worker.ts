// planning-worker.ts — Event-driven replanning worker for the planning_queue.
//
// Polls the planning_queue table for unclaimed events (FOR UPDATE SKIP LOCKED),
// re-optimises only the affected driver, persists to routes/route_jobs, and
// marks the event as processed.
//
// This is single-driver scope (not whole fleet) — fine for late-arrival and
// excessive-dwell triggers. For full daily plans, use plan-jobs-core.server.ts.

import { createClient } from "@supabase/supabase-js";
import { buildHoursLedger } from "@/lib/driver-hours-ledger";
import { fetchShiftsByDriver } from "@/lib/driver-shifts";
import { makeTravelHours } from "@/lib/travel-provider";
import { planDay } from "@/lib/plan-day";
import { toRoutePersistence } from "@/lib/route-persistence";

const POLL_INTERVAL_MS = 10_000;

type AnyClient = ReturnType<typeof createClient>;
type AnyClientFrom = { from: (table: string) => any };

let supabaseAdmin: AnyClient | null = null;

function getClient(): AnyClient {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return supabaseAdmin;
}

/**
 * Polls planning_queue for unprocessed events and replans the affected driver.
 * Runs in a loop — call from an IIFE in the worker entrypoint.
 */
export async function runPlanningWorker(tenantId: string): Promise<void> {
  const client = getClient();
  const sb = client as unknown as AnyClientFrom;
  console.log(`[planning-worker] Starting for tenant ${tenantId}`);

  while (true) {
    try {
      // CLAIM events with FOR UPDATE SKIP LOCKED so multiple workers don't
      // fight over the same row.
      const { data: events } = await (client as any).rpc("claim_planning_events", {
        p_tenant_id: tenantId,
        p_limit: 10,
      });

      const eventList = (events ?? []) as any[];

      if (eventList.length === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      for (const ev of eventList) {
        await processEvent(sb, ev, tenantId);
      }
    } catch (err) {
      console.error("[planning-worker] Error in poll loop:", err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function processEvent(
  sb: AnyClientFrom,
  event: { id: string; event_type: string; driver_id?: string; payload?: any },
  tenantId: string,
) {
  const driverId = event.driver_id ?? event.payload?.driver_id;
  if (!driverId) {
    await sb.from("planning_queue").update({ status: "processed" }).eq("id", event.id);
    return;
  }

  const nowMs = Date.now();
  const targetDate = new Date(nowMs).toISOString().slice(0, 10);

  // Load data only for the affected driver
  const [{ data: drivers }, { data: jobs }, { data: warehouses }, { data: lanes }] =
    await Promise.all([
      sb.from("drivers").select("*").eq("id", driverId).eq("tenant_id", tenantId),
      sb.from("jobs").select("*").eq("assigned_driver_id", driverId).eq("for_date", targetDate).eq("tenant_id", tenantId),
      sb.from("warehouses").select("*").eq("tenant_id", tenantId),
      sb.from("lane_travel_times").select(
        "from_warehouse_id,to_warehouse_id,day_of_week,hour_of_day,p50_duration_minutes,avg_duration_minutes"
      ).eq("tenant_id", tenantId),
    ]);

  const driverList = (drivers ?? []) as any[];
  if (driverList.length === 0) return;

  const driverIds = driverList.map((d: any) => d.id as string);
  const ledger = await buildHoursLedger(sb, driverIds, nowMs);
  const shifts = await fetchShiftsByDriver(sb as any, driverIds);

  const result = planDay({
    targetDate,
    jobs: (jobs ?? []) as any,
    stopsMap: {},
    drivers: driverList,
    warehouses: (warehouses ?? []) as any,
    ledger,
    shifts,
    overrides: [],
    travelHours: makeTravelHours((lanes ?? []) as any),
    nowMs,
  });

  const plannerRunId = crypto.randomUUID();
  for (const pr of toRoutePersistence(result, { tenantId, routeDate: targetDate, plannerRunId })) {
    const { data: route } = await sb.from("routes").insert(pr.route).select("id").single();
    if (route) {
      await sb.from("route_jobs").insert(
        pr.jobs.map((j) => ({ ...j, route_id: (route as any).id }))
      );
    }
  }

  await sb.from("planning_queue").update({ status: "processed" }).eq("id", event.id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Entrypoint guard: run only when executed directly (not imported).
if (require.main === module) {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    console.error("TENANT_ID env var required");
    process.exit(1);
  }
  runPlanningWorker(tenantId);
}
