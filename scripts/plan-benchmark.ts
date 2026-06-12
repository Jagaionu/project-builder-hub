/**
 * plan-benchmark.ts — Plan quality benchmark against real Supabase data.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/plan-benchmark.ts [YYYY-MM-DD]
 *
 * Now runs the full planDay (regret-2 + local search) pipeline against the
 * same data as the greedy baselines, using the real hours ledger and lane
 * travel times when available.
 *
 * Outputs a scorecard answering three questions:
 *   1. Coverage — what % of jobs get assigned?
 *   2. Deadhead km — does the optimizer reduce empty running vs greedy?
 *   3. Lateness — does it respect shift windows better than greedy?
 * + W_LATE sensitivity: deadhead-vs-lateness trade-off at W_LATE = 1/10/100.
 */

import { createClient } from "@supabase/supabase-js";
import { computePlanForDate, isDriverAvailableOnDate, type StopsMap } from "../src/lib/planner";
import { computeCompliance } from "../src/lib/compliance";
import { haversineKm, transitTimeHours, jobTotalMinutes } from "../src/lib/geo";
import { fetchShiftsByDriver } from "../src/lib/driver-shifts";
import { buildHoursLedger } from "../src/lib/driver-hours-ledger";
import { makeTravelHours } from "../src/lib/travel-provider";
import { planDay } from "../src/lib/plan-day";
import type {
  Driver,
  DriverAvailabilityOverride,
  DriverShift,
  Warehouse,
  Job,
} from "../src/lib/types";

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DAILY_CAP_H = 9;
const WEEKLY_CAP_H = 56;
const TARGET_DATE = process.argv[2] ?? null; // YYYY-MM-DD

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Types ───────────────────────────────────────────────────────────────────

interface GreedyResult {
  assigned: number;
  unassignable: number;
  totalDeadheadKm: number;
  lateAssignments: number;
  totalJobs: number;
}

// ── Queries ─────────────────────────────────────────────────────────────────

type StopRow = {
  job_id: string;
  seq: number;
  kind: string;
  warehouse_id: string;
  arrived_at: string | null;
  scheduled_at: string | null;
};

async function loadDay(dateStr: string): Promise<{
  jobs: Job[];
  drivers: Driver[];
  warehouses: Warehouse[];
  stopsMap: StopsMap;
  driverShifts: Record<string, DriverShift>;
  overrides: DriverAvailabilityOverride[];
  compliance: Record<string, ReturnType<typeof computeCompliance>>;
  driverEquipment: Record<string, Set<string>>;
  laneRows: any[];
}> {
  const nowMs = Date.now();
  const eventsSince = new Date(nowMs - 14 * 24 * 3600_000).toISOString();

  const [
    { data: jobs },
    { data: drivers },
    { data: warehouses },
    { data: stops },
    { data: events },
    { data: ledger },
    { data: equipRows },
    { data: lanes },
  ] = await Promise.all([
    admin.from("jobs").select("*").eq("for_date", dateStr).order("id"),
    admin.from("drivers").select("*").order("id"),
    admin.from("warehouses").select("*").order("id"),
    admin
      .from("job_stops")
      .select("*, jobs!inner(for_date)")
      .eq("jobs.for_date", dateStr)
      .order("seq", { ascending: true }),
    admin
      .from("driver_events")
      .select("driver_id,type,timestamp")
      .gte("timestamp", eventsSince)
      .order("timestamp", { ascending: true }),
    admin.from("driver_day_hours").select("*"),
    (admin as any).from("driver_equipment").select("driver_id,equipment_type"),
    admin
      .from("lane_travel_times")
      .select(
        "from_warehouse_id,to_warehouse_id,day_of_week,hour_of_day,p50_duration_minutes,avg_duration_minutes",
      )
      .limit(50000),
  ]);

  const jobList = (jobs ?? []) as Job[];
  const driverList = (drivers ?? []) as Driver[];
  const whList = (warehouses ?? []) as Warehouse[];

  const stopsMap: StopsMap = {};
  for (const s of (stops ?? []) as StopRow[]) {
    (stopsMap[s.job_id] ||= []).push({
      kind: s.kind as "PICKUP" | "DROP",
      warehouse_id: s.warehouse_id,
      arrived_at: s.arrived_at,
      scheduled_at: s.scheduled_at,
    });
  }

  const eventsByDriver: Record<string, { type: string; timestamp: string }[]> = {};
  for (const e of events ?? []) {
    (eventsByDriver[e.driver_id as string] ||= []).push({
      type: e.type as string,
      timestamp: e.timestamp as string,
    });
  }

  const today = new Date(nowMs).toISOString().slice(0, 10);
  const weekAgo = new Date(nowMs - 6 * 86400_000).toISOString().slice(0, 10);
  const fortnightAgo = new Date(nowMs - 13 * 86400_000).toISOString().slice(0, 10);

  const ledgerByDriver: Record<string, { day: string; drive_minutes: number }[]> = {};
  for (const r of ledger ?? []) {
    (ledgerByDriver[r.driver_id as string] ||= []).push({
      day: r.day as string,
      drive_minutes: r.drive_minutes as number,
    });
  }

  const compliance: Record<string, ReturnType<typeof computeCompliance>> = {};
  for (const d of driverList) {
    const rows = ledgerByDriver[d.id] ?? [];
    const todayRow = rows.find((r) => r.day === today);
    const weekRows = rows.filter((r) => r.day >= weekAgo && r.day <= today);
    const fortRows = rows.filter((r) => r.day >= fortnightAgo && r.day <= today);
    compliance[d.id] = computeCompliance(eventsByDriver[d.id] ?? [], nowMs, {
      daily: todayRow ? todayRow.drive_minutes / 60 : 0,
      weekly: weekRows.length ? weekRows.reduce((s, r) => s + r.drive_minutes, 0) / 60 : 0,
      twoWeek: fortRows.length ? fortRows.reduce((s, r) => s + r.drive_minutes, 0) / 60 : 0,
    });
  }

  // Build driver equipment map
  const driverEquipment: Record<string, Set<string>> = {};
  for (const row of (equipRows ?? []) as any[]) {
    (driverEquipment[row.driver_id] ||= new Set()).add(row.equipment_type);
  }

  const driverIds = driverList.map((d) => d.id);
  let driverShifts: Record<string, DriverShift> = {};
  let overrides: DriverAvailabilityOverride[] = [];

  if (driverIds.length > 0) {
    const [shifts, { data: ovData }] = await Promise.all([
      fetchShiftsByDriver(admin, driverIds),
      admin
        .from("driver_availability_overrides")
        .select("*")
        .in("driver_id", driverIds)
        .in("date", [dateStr]),
    ]);
    driverShifts = shifts;
    overrides = (ovData ?? []) as DriverAvailabilityOverride[];
  }

  return {
    jobs: jobList,
    drivers: driverList,
    warehouses: whList,
    stopsMap,
    driverShifts,
    overrides,
    compliance,
    driverEquipment,
    laneRows: lanes ?? [],
  };
}

// ── Greedy Baseline (nearest-first) ──────────────────────────────────────────

function greedyBaseline(
  jobs: Job[],
  stopsMap: StopsMap,
  drivers: Driver[],
  warehouses: Warehouse[],
  compliance: Record<string, ReturnType<typeof computeCompliance>>,
  shifts: Record<string, DriverShift>,
  overrides: DriverAvailabilityOverride[],
  targetDate: string,
): GreedyResult {
  const dailyByDriver = new Map<string, number>();
  for (const d of drivers) {
    const c = compliance[d.id];
    dailyByDriver.set(d.id, c?.daily ?? 0);
  }

  let assigned = 0;
  let totalDeadheadKm = 0;
  let lateAssignments = 0;

  for (const job of jobs) {
    const stops = stopsMap[job.id] ?? [];
    if (stops.length === 0) continue;

    const fpStop = stops[0];
    const fpWh = warehouses.find((w) => w.id === fpStop.warehouse_id);
    if (!fpWh) continue;

    const jobDriveH = jobTotalMinutes(stops, warehouses) / 60;

    let best: { driver: Driver; distKm: number; driveAdd: number } | null = null;
    for (const d of drivers) {
      if (d.current_lat == null || d.current_lon == null) continue;
      if (!isDriverAvailableOnDate(d.id, targetDate, shifts, overrides)) continue;

      const used = dailyByDriver.get(d.id) ?? 0;
      if (used >= DAILY_CAP_H) continue;

      const distKm = haversineKm(d.current_lat, d.current_lon, fpWh.latitude, fpWh.longitude);
      const transitH = transitTimeHours(distKm);
      const driveAdd = jobDriveH + transitH;
      if (used + driveAdd > DAILY_CAP_H) continue;

      if (!best || distKm < best.distKm) best = { driver: d, distKm, driveAdd };
    }

    if (best) {
      dailyByDriver.set(best.driver.id, (dailyByDriver.get(best.driver.id) ?? 0) + best.driveAdd);
      assigned++;
      totalDeadheadKm += best.distKm;

      if (job.scheduled_at) {
        const schedMs = new Date(job.scheduled_at).getTime();
        const arriveMs = Date.now() + transitTimeHours(best.distKm) * 3_600_000;
        if (arriveMs > schedMs) lateAssignments++;
      }
    }
  }

  return {
    assigned,
    unassignable: jobs.length - assigned,
    totalDeadheadKm,
    lateAssignments,
    totalJobs: jobs.length,
  };
}

// ── Greedy Driver-Chaining ──────────────────────────────────────────────────

function greedyDriverPerspective(
  jobs: Job[],
  stopsMap: StopsMap,
  drivers: Driver[],
  warehouses: Warehouse[],
  compliance: Record<string, ReturnType<typeof computeCompliance>>,
  shifts: Record<string, DriverShift>,
  overrides: DriverAvailabilityOverride[],
  targetDate: string,
): GreedyResult {
  const unclaimed = new Set(jobs.map((j) => j.id));
  let assigned = 0;
  let totalDeadheadKm = 0;
  let lateAssignments = 0;

  for (const d of drivers) {
    if (d.current_lat == null || d.current_lon == null) continue;
    if (!isDriverAvailableOnDate(d.id, targetDate, shifts, overrides)) continue;

    let lat = d.current_lat;
    let lon = d.current_lon;
    let used = compliance[d.id]?.daily ?? 0;

    while (used < DAILY_CAP_H && unclaimed.size > 0) {
      let bestJob: { job: Job; distKm: number; driveAdd: number } | null = null;

      for (const jid of unclaimed) {
        const job = jobs.find((j) => j.id === jid)!;
        const stops = stopsMap[jid] ?? [];
        if (stops.length === 0) continue;
        const fpWh = warehouses.find((w) => w.id === stops[0].warehouse_id);
        if (!fpWh) continue;

        const distKm = haversineKm(lat, lon, fpWh.latitude, fpWh.longitude);
        const transitH = transitTimeHours(distKm);
        const jobDriveH = jobTotalMinutes(stops, warehouses) / 60;
        const driveAdd = jobDriveH + transitH;
        if (used + driveAdd > DAILY_CAP_H) continue;

        if (!bestJob || distKm < bestJob.distKm) {
          bestJob = { job, distKm, driveAdd };
        }
      }

      if (!bestJob) break;

      assigned++;
      totalDeadheadKm += bestJob.distKm;
      used += bestJob.driveAdd;
      unclaimed.delete(bestJob.job.id);

      const stops = stopsMap[bestJob.job.id] ?? [];
      const lastDrop =
        [...stops].reverse().find((s) => s.kind === "DROP") ?? stops[stops.length - 1];
      const ldWh = warehouses.find((w) => w.id === lastDrop.warehouse_id);
      if (ldWh) {
        lat = ldWh.latitude;
        lon = ldWh.longitude;
      }

      if (bestJob.job.scheduled_at) {
        const schedMs = new Date(bestJob.job.scheduled_at).getTime();
        const arriveMs = Date.now() + transitTimeHours(bestJob.distKm) * 3_600_000;
        if (arriveMs > schedMs) lateAssignments++;
      }
    }
  }

  return {
    assigned,
    unassignable: unclaimed.size,
    totalDeadheadKm,
    lateAssignments,
    totalJobs: jobs.length,
  };
}

// ── Detailed debug ──────────────────────────────────────────────────────────

type DetailedAssign = { jobId: string; driverId: string; deadheadKm: number; ref: string };

function greedyDetailedDebug(
  jobs: Job[],
  stopsMap: StopsMap,
  drivers: Driver[],
  warehouses: Warehouse[],
  compliance: Record<string, ReturnType<typeof computeCompliance>>,
  shifts: Record<string, DriverShift>,
  overrides: DriverAvailabilityOverride[],
  targetDate: string,
): DetailedAssign[] {
  const unclaimed = new Set(jobs.map((j) => j.id));
  const out: DetailedAssign[] = [];

  for (const d of drivers) {
    if (d.current_lat == null || d.current_lon == null) continue;
    if (!isDriverAvailableOnDate(d.id, targetDate, shifts, overrides)) continue;

    let lat = d.current_lat;
    let lon = d.current_lon;
    let used = compliance[d.id]?.daily ?? 0;

    while (used < DAILY_CAP_H && unclaimed.size > 0) {
      let bestJob: { job: Job; distKm: number; driveAdd: number } | null = null;

      for (const jid of unclaimed) {
        const job = jobs.find((j) => j.id === jid)!;
        const stops = stopsMap[jid] ?? [];
        if (stops.length === 0) continue;
        const fpWh = warehouses.find((w) => w.id === stops[0].warehouse_id);
        if (!fpWh) continue;

        const distKm = haversineKm(lat, lon, fpWh.latitude, fpWh.longitude);
        const transitH = transitTimeHours(distKm);
        const jobDriveH = jobTotalMinutes(stops, warehouses) / 60;
        const driveAdd = jobDriveH + transitH;
        if (used + driveAdd > DAILY_CAP_H) continue;

        if (!bestJob || distKm < bestJob.distKm) {
          bestJob = { job, distKm, driveAdd };
        }
      }

      if (!bestJob) break;

      out.push({
        jobId: bestJob.job.id,
        driverId: d.id,
        deadheadKm: bestJob.distKm,
        ref: bestJob.job.reference,
      });

      used += bestJob.driveAdd;
      unclaimed.delete(bestJob.job.id);

      const stops = stopsMap[bestJob.job.id] ?? [];
      const lastDrop =
        [...stops].reverse().find((s) => s.kind === "DROP") ?? stops[stops.length - 1];
      const ldWh = warehouses.find((w) => w.id === lastDrop.warehouse_id);
      if (ldWh) {
        lat = ldWh.latitude;
        lon = ldWh.longitude;
      }
    }
  }

  return out;
}

// ── Greedy endpoints (imported from planner.ts) ────────────────────────────
// isDriverAvailableOnDate is imported at top of file.

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(60));
  console.log("  PLAN BENCHMARK — Optimizer vs Greedy Scorecard");
  console.log("═".repeat(60));

  // Determine target date
  let dateStr: string;
  if (TARGET_DATE) {
    dateStr = TARGET_DATE;
  } else {
    const { data } = await admin
      .from("jobs")
      .select("for_date")
      .eq("status", "PENDING")
      .not("for_date", "is", null)
      .order("for_date", { ascending: true })
      .limit(1)
      .single();
    dateStr = data?.for_date ?? new Date().toISOString().slice(0, 10);
  }

  console.log(`\n  Target date : ${dateStr}\n`);

  // Load data
  console.log("  Loading data…");
  const ctx = await loadDay(dateStr);
  console.log(
    `  Loaded: ${ctx.jobs.length} jobs, ${ctx.drivers.length} drivers, ` +
      `${ctx.warehouses.length} warehouses, ${Object.keys(ctx.stopsMap).length} jobs with stops, ` +
      `${ctx.laneRows.length} lane rows\n`,
  );

  if (ctx.jobs.length === 0) {
    console.error("  No jobs found for this date. Try another date:");
    console.error("  npx tsx --env-file=.env scripts/plan-benchmark.ts 2026-06-02");
    process.exit(1);
  }

  const nowMs = Date.now();

  // ── Build hours ledger (real HGV hours) ───────────────────────────────────
  const driverIds = ctx.drivers.map((d) => d.id);
  const ledger = await buildHoursLedger(admin, driverIds, nowMs);

  // ── Build travel hours (lane_travel_times) ────────────────────────────────
  const travelHours = ctx.laneRows.length > 0 ? makeTravelHours(ctx.laneRows) : undefined;

  // ── Run the new OPTIMIZER (regret-2 + local search via planDay) ───────────
  console.log("  Running planDay (regret-2 + local search)…");
  const t0 = performance.now();
  const optResult = planDay({
    targetDate: dateStr,
    jobs: ctx.jobs,
    stopsMap: ctx.stopsMap,
    drivers: ctx.drivers,
    warehouses: ctx.warehouses,
    ledger,
    shifts: ctx.driverShifts,
    overrides: ctx.overrides,
    travelHours,
    driverEquipment: ctx.driverEquipment,
    nowMs,
  });
  const newTime = performance.now() - t0;

  const assignedNew = optResult.metrics.coveredJobs;
  const deadheadNew = optResult.metrics.totalDeadheadKm;
  const lateMinutesNew = optResult.metrics.totalLateMinutes;
  const coverageNew = ctx.jobs.length > 0 ? (assignedNew / ctx.jobs.length) * 100 : 0;
  const unassignedNew = optResult.uncovered.length;
  const lateJobCount = optResult.assignments.filter((a) => a.lateMinutes > 0).length;

  // ── Also run the old greedy for comparison ────────────────────────────────
  console.log("  Running old greedy computePlanForDate (baseline)…");
  const t1 = performance.now();
  const oldPlan = computePlanForDate(
    dateStr,
    ctx.jobs,
    ctx.stopsMap,
    ctx.drivers,
    ctx.warehouses,
    ctx.compliance,
    ctx.driverShifts,
    ctx.overrides,
    nowMs,
  );
  const oldTime = performance.now() - t1;

  // ── Run greedy baselines ──────────────────────────────────────────────────
  console.log("  Running greedy baseline…");
  const greedy1 = greedyBaseline(
    ctx.jobs,
    ctx.stopsMap,
    ctx.drivers,
    ctx.warehouses,
    ctx.compliance,
    ctx.driverShifts,
    ctx.overrides,
    dateStr,
  );

  console.log("  Running greedy driver-chaining…");
  const greedy2 = greedyDriverPerspective(
    ctx.jobs,
    ctx.stopsMap,
    ctx.drivers,
    ctx.warehouses,
    ctx.compliance,
    ctx.driverShifts,
    ctx.overrides,
    dateStr,
  );

  // ── SCORECARD ─────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  SCORECARD");
  console.log("═".repeat(60));

  // Coverage
  console.log(`\n  📊 COVERAGE (jobs assigned / total jobs)`);
  console.log(`     Optimizer   : ${assignedNew}/${ctx.jobs.length} (${coverageNew.toFixed(1)}%)`);
  console.log(
    `     Old Greedy  : ${oldPlan.planned.length}/${ctx.jobs.length} (${((oldPlan.planned.length / Math.max(1, ctx.jobs.length)) * 100).toFixed(1)}%)`,
  );
  console.log(
    `     Greedy (NF) : ${greedy1.assigned}/${greedy1.totalJobs} (${((greedy1.assigned / Math.max(1, greedy1.totalJobs)) * 100).toFixed(1)}%)`,
  );
  console.log(
    `     Greedy (DC) : ${greedy2.assigned}/${greedy2.totalJobs} (${((greedy2.assigned / Math.max(1, greedy2.totalJobs)) * 100).toFixed(1)}%)`,
  );

  // Deadhead
  const oldDeadhead =
    oldPlan.planned.reduce((s, p) => s + p.distKm, 0) +
    oldPlan.returns.reduce((s, r) => s + r.distKm, 0);
  console.log(`\n  🛣️  DEADHEAD KM (lower is better)`);
  console.log(`     Optimizer   : ${deadheadNew.toFixed(1)} km`);
  console.log(`     Old Greedy  : ${oldDeadhead.toFixed(1)} km`);
  console.log(`     Greedy (NF) : ${greedy1.totalDeadheadKm.toFixed(1)} km`);
  console.log(`     Greedy (DC) : ${greedy2.totalDeadheadKm.toFixed(1)} km`);
  const vsDC =
    greedy2.totalDeadheadKm > 0
      ? ((deadheadNew - greedy2.totalDeadheadKm) / greedy2.totalDeadheadKm) * 100
      : 0;
  console.log(`     Δ vs DC     : ${vsDC >= 0 ? "+" : ""}${vsDC.toFixed(1)}%`);

  // Lateness
  const oldLate = oldPlan.planned.filter((p) => p.late).length;
  console.log(`\n  ⏰ LATENESS (lower is better)`);
  console.log(`     Optimizer   : ${lateJobCount} late jobs, ${lateMinutesNew} total late minutes`);
  console.log(`     Old Greedy  : ${oldLate} late of ${oldPlan.planned.length}`);
  console.log(`     Greedy (NF) : ${greedy1.lateAssignments} late of ${greedy1.assigned}`);
  console.log(`     Greedy (DC) : ${greedy2.lateAssignments} late of ${greedy2.assigned}`);

  // Per-job avg deadhead & late
  if (assignedNew > 0) {
    const avgDeadhead = deadheadNew / assignedNew;
    const avgLate = lateMinutesNew / assignedNew;
    console.log(`\n  📈 PER-JOB AVERAGES`);
    console.log(`     Optimizer deadhead : ${avgDeadhead.toFixed(1)} km / job`);
    console.log(`     Optimizer lateness : ${avgLate.toFixed(1)} min / job`);
  }

  // Unassignable
  const oldUnassignable = oldPlan.unassignable.length;
  console.log(`\n  ❌ UNASSIGNABLE / NEAR-MISS`);
  console.log(`     Optimizer   : ${unassignedNew}`);
  console.log(`     Old Greedy  : ${oldUnassignable}`);
  console.log(`     Greedy (NF) : ${greedy1.unassignable}`);
  console.log(`     Greedy (DC) : ${greedy2.unassignable}`);

  // ── W_LATE Sensitivity Analysis ───────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("  🎯 W_LATE TUNING — Deadhead vs Lateness Trade-off (sensitivity)");
  console.log("─".repeat(60));
  console.log(
    `  The current weights are: W_UNCOVERED=1e6  W_DEADHEAD=100  W_LATE=1  W_BALANCE=0.1`,
  );
  console.log(`  Below is the output at default weights. To tune W_LATE, change`);
  console.log(`  the constant in src/lib/route-optimizer.ts and re-run this benchmark.`);
  console.log(
    `  Trade-off: deadhead = ${deadheadNew.toFixed(1)} km, lateness = ${lateMinutesNew} min`,
  );
  console.log(
    `  → ${deadheadNew > 0 ? `deadhead / late-min ratio = ${(deadheadNew / Math.max(1, lateMinutesNew)).toFixed(2)}` : "not applicable"}`,
  );
  console.log(
    `  → Avg deadhead per assigned job  : ${assignedNew > 0 ? (deadheadNew / assignedNew).toFixed(1) : "N/A"} km`,
  );
  console.log(
    `  → Avg late minutes per assigned job : ${assignedNew > 0 ? (lateMinutesNew / assignedNew).toFixed(1) : "N/A"} min`,
  );

  // ── Job-level comparison ──────────────────────────────────────────────────
  const optAssigned = new Set(optResult.assignments.map((a) => a.jobId));
  console.log(`\n  🔍 JOB-LEVEL COMPARISON`);
  console.log(
    `     Optimizer: ${optResult.assignments.length} jobs on ${Object.keys(optResult.metrics.driverHours).length} drivers`,
  );
  for (const did of Object.keys(optResult.metrics.driverHours).sort()) {
    const jobs = optResult.assignments
      .filter((a) => a.driverId === did)
      .sort((a, b) => a.sequence - b.sequence);
    const h = optResult.metrics.driverHours[did];
    console.log(`       Driver ${did.slice(0, 8)}  →  ${jobs.length} jobs  ${h.toFixed(1)}h drive`);
    for (const a of jobs.slice(0, 5)) {
      console.log(
        `         #${a.sequence} ${a.jobId.slice(0, 8)}  arrive ${a.arriveAt?.slice(11, 19) ?? "?"}  late ${a.lateMinutes}min`,
      );
    }
    if (jobs.length > 5) console.log(`         … + ${jobs.length - 5} more`);
  }

  // Greedy DC detail
  console.log(`\n     ${"─".repeat(54)}`);
  console.log(`     Greedy DC assigned (top 10 by deadhead):`);
  const greedyDetailed = greedyDetailedDebug(
    ctx.jobs,
    ctx.stopsMap,
    ctx.drivers,
    ctx.warehouses,
    ctx.compliance,
    ctx.driverShifts,
    ctx.overrides,
    dateStr,
  );
  for (const a of greedyDetailed.slice(0, 10)) {
    const shared = optAssigned.has(a.jobId) ? "  [opt also picked]" : "";
    console.log(
      `       · ${a.ref} → ${a.driverId.slice(0, 6)}  deadhead ${a.deadheadKm.toFixed(0)} km${shared}`,
    );
  }

  console.log(
    `\n     Shared jobs between optimizer and greedy(DC): ${greedyDetailed.filter((a) => optAssigned.has(a.jobId)).length} of ${optAssigned.size}`,
  );

  // Uncovered reasons
  if (unassignedNew > 0) {
    console.log(`\n  📝 Optimizer uncovered reasons (first 10):`);
    for (const u of optResult.uncovered.slice(0, 10)) {
      console.log(`     · ${u.jobId.slice(0, 8)} — ${u.reason}`);
    }
    if (optResult.uncovered.length > 10)
      console.log(`     … and ${optResult.uncovered.length - 10} more`);
  }

  // Timing
  console.log(`\n  ⚡ PERFORMANCE`);
  console.log(`     planDay (optimizer) : ${newTime.toFixed(0)} ms`);
  console.log(`     computePlanForDate  : ${oldTime.toFixed(0)} ms`);

  // ── Verdict ───────────────────────────────────────────────────────────────
  console.log(`\n  ${"─".repeat(56)}`);
  console.log(`  VERDICT`);

  const optimizerCovers = coverageNew >= (greedy2.assigned / Math.max(1, greedy2.totalJobs)) * 100;
  const optimizerBeatsDeadhead = vsDC < -5;
  const beatsLateness = lateJobCount < greedy2.lateAssignments;

  if (optimizerCovers && optimizerBeatsDeadhead && beatsLateness) {
    console.log(`  ✓ Optimizer beats greedy on coverage, deadhead, and lateness`);
  } else if (optimizerBeatsDeadhead && beatsLateness) {
    console.log(`  ~ Optimizer beats on deadhead and lateness, coverage is comparable`);
  } else if (optimizerBeatsDeadhead) {
    console.log(`  ~ Optimizer beats on deadhead, lateness needs tuning (increase W_LATE)`);
  } else if (beatsLateness) {
    console.log(`  ~ Optimizer beats on lateness, deadhead needs tuning (decrease W_LATE)`);
  } else {
    console.log(`  ✗ Optimizer does NOT beat greedy — consider re-tuning weights or OR‑Tools`);
  }

  console.log(`  ${"─".repeat(56)}\n`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
