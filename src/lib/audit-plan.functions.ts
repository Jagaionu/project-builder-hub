/**
 * audit-plan.functions.ts
 *
 * Drop-in replacement for planJobs that runs the EXACT same logic
 * but writes NOTHING to the DB. Returns a full decision trace so you
 * can understand why driver X was (or was not) assigned to job Z.
 *
 * Usage:
 *   import { auditPlan } from "@/lib/audit-plan.functions";
 *   const report = await runAuditPlan();
 *   console.log(JSON.stringify(report, null, 2));
 *
 * Or wire it to a button in the Dispatch page:
 *   <ToolbarButton onClick={async () => {
 *     const r = await runAuditPlan();
 *     downloadJson(r, `plan-audit-${new Date().toISOString()}.json`);
 *   }}>
 *     Audit Plan
 *   </ToolbarButton>
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId, isSuperAdmin } from "@/lib/auth-helpers.server";
import { computeCompliance, type ComplianceEvent } from "@/lib/compliance";
import { haversineKm, transitTimeHours, stopDwellMinutes, ARRIVAL_BUFFER_MINUTES } from "@/lib/geo";
import { fetchShiftsByDriver } from "@/lib/driver-shifts";
import { isDriverAvailableOnDate } from "@/lib/planner";
import type { Driver, DriverAvailabilityOverride, DriverShift, Warehouse, Job } from "@/lib/types";
import type { PlannerStop, StopsMap } from "@/lib/planner";

// ─────────────────────────────────────────────────────────────────────────────
// Audit report types
// ─────────────────────────────────────────────────────────────────────────────

export type DriverSnapshot = {
  driverId: string;
  name: string;
  status: string;
  lat: number | null;
  lon: number | null;
  // Compliance at the moment Plan was pressed
  daily_hours: number;
  weekly_hours: number;
  twoWeek_hours: number;
  continuous_drive: number;
  daily_cap: number; // effective cap (reduced if near weekly/fortnightly limit)
  hours_left: number;
  compliance_block: boolean;
  compliance_issues: string[];
};

export type DriverEligibilityTrace = {
  driverId: string;
  name: string;
  eligible: boolean;
  // Why ineligible (all that apply):
  reasons_excluded: string[];
};

export type CandidateEval = {
  driverId: string;
  driverName: string;
  dist_km: number;
  transit_hours: number;
  drive_add_hours: number; // jobH + transit
  hours_left_before: number;
  hours_left_after: number;
  weekly_before: number;
  weekly_after: number;
  continuous_before: number;
  break_inserted: boolean; // 45-min break triggered
  depart_ms: number;
  depart_iso: string;
  // Why this candidate was skipped (empty = valid candidate)
  skip_reason: string | null;
  // Was this the winner?
  selected: boolean;
};

export type JobTrace = {
  jobId: string;
  reference: string;
  for_date: string | null;
  scheduled_at: string | null;
  stop_count: number;
  stops: Array<{ seq: number; kind: string; warehouse_code: string; scheduled_at: string | null }>;
  first_pickup_warehouse: string | null;
  job_drive_hours: number;
  job_wall_hours: number;
  // Result
  outcome: "ASSIGNED" | "UNASSIGNABLE" | "NO_DATE";
  assigned_driver_id: string | null;
  assigned_driver_name: string | null;
  planned_sequence: number | null;
  planned_start_at: string | null;
  unassignable_reason: string | null;
  // Full candidate evaluation — every driver considered and why
  candidates: CandidateEval[];
};

export type DateGroupTrace = {
  date: string;
  job_count: number;
  eligible_driver_count: number;
  jobs: JobTrace[];
};

export type AuditReport = {
  // When the audit was run — key for reproducibility analysis
  audit_run_at: string;
  now_ms: number;
  tenant_id: string | null;
  /** Plain-language explanation of the plan's decisions, written for the AI
   *  assistant to turn into a diagram of why each route was/was not assigned. */
  ai_explanation: string;
  // Constants used by the planner
  constants: {
    auto_assign_radius_km: number;
    chain_radius_km: number;
    daily_cap_default: number;
    weekly_cap: number;
    break_threshold_hours: number;
    break_duration_minutes: number;
    nominal_start_utc: string; // "06:00:00Z"
    city_speed_kmh: number;
    highway_speed_kmh: number;
    city_distance_km: number;
    arrival_buffer_minutes: number;
    loading_minutes: number;
    unloading_minutes: number;
    checks_minutes: number;
  };
  // Summary
  summary: {
    total_pending_jobs: number;
    total_no_date_jobs: number;
    total_assigned: number;
    total_unassignable: number;
    drivers_used: number;
    dates_planned: string[];
  };
  // Per-driver state at the moment of planning
  driver_snapshots: DriverSnapshot[];
  // Per-driver eligibility decision
  driver_eligibility: DriverEligibilityTrace[];
  // Per-date breakdown with full per-job trace
  date_groups: DateGroupTrace[];
  // Non-determinism warning
  non_determinism_warning: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants (mirrored from planner.ts — keep in sync)
// ─────────────────────────────────────────────────────────────────────────────

const AUTO_ASSIGN_RADIUS_KM = 30;
const CHAIN_RADIUS_KM = 80;
const DAILY_CAP_DEFAULT = 9;
const WEEKLY_CAP = 56;
const BREAK_THRESHOLD_HOURS = 4.5;
const BREAK_DURATION_MINUTES = 45;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (mirrors of planner.ts private helpers)
// ─────────────────────────────────────────────────────────────────────────────

function jobDriveHours(stops: PlannerStop[], warehouses: Warehouse[]): number {
  if (stops.length === 0) return 0;
  let minutes = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = warehouses.find((w) => w.id === stops[i].warehouse_id);
    const b = warehouses.find((w) => w.id === stops[i + 1].warehouse_id);
    if (!a || !b) continue;
    minutes +=
      Math.round(
        transitTimeHours(haversineKm(a.latitude, a.longitude, b.latitude, b.longitude)) * 60,
      ) + ARRIVAL_BUFFER_MINUTES;
  }
  return minutes / 60;
}

function firstPickupWh(stops: PlannerStop[], warehouses: Warehouse[]): Warehouse | null {
  if (!stops.length) return null;
  const fp = stops.find((s) => s.kind === "PICKUP") ?? stops[0];
  return warehouses.find((w) => w.id === fp.warehouse_id) ?? null;
}

function lastDropWh(stops: PlannerStop[], warehouses: Warehouse[]): Warehouse | null {
  if (!stops.length) return null;
  const ld = [...stops].reverse().find((s) => s.kind === "DROP") ?? stops[stops.length - 1];
  return warehouses.find((w) => w.id === ld.warehouse_id) ?? null;
}

function effectiveDailyCap(compliance: ReturnType<typeof computeCompliance>): number {
  let cap = DAILY_CAP_DEFAULT;
  if (compliance.weekly >= 47) cap = Math.min(cap, WEEKLY_CAP - compliance.weekly);
  if (compliance.twoWeek >= 81) cap = Math.min(cap, 90 - compliance.twoWeek);
  return Math.max(0, cap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Server function
// ─────────────────────────────────────────────────────────────────────────────

export const auditPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ tenantId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<AuditReport> => {
    const { userId } = context;
    const superAdmin = await isSuperAdmin(userId);
    // Super admin may target a specific company (or null = all companies, for a
    // platform-wide audit). Everyone else is locked to their own tenant.
    const tenantId = superAdmin ? (data?.tenantId ?? null) : await getUserTenantId(userId);
    if (!superAdmin && !tenantId) throw new Error("Forbidden");

    // ── Snapshot nowMs once — same as planJobs does ──────────────────────────
    // NOTE: This is one of the non-determinism sources. Two runs milliseconds
    // apart will see different GPS positions and compliance windows.
    const nowMs = Date.now();
    const auditRunAt = new Date(nowMs).toISOString();
    const eventsSince = new Date(nowMs - 14 * 24 * 3600 * 1000).toISOString();

    // ── 1. Load all data (identical queries to planJobs) ─────────────────────
    const jobsQ = supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("status", "PENDING")
      .is("assigned_driver_id", null); // manual_override jobs are included — adjusted time ≠ exclude from planning

    const stopsQ = supabaseAdmin.from("job_stops").select("*, jobs!inner(tenant_id)").order("seq");

    const driversQ = supabaseAdmin.from("drivers").select("*");
    const whQ = supabaseAdmin.from("warehouses").select("*");

    const eventsQ = supabaseAdmin
      .from("driver_events")
      .select("driver_id,type,timestamp")
      .gte("timestamp", eventsSince);

    const [
      { data: jobs },
      { data: drivers },
      { data: warehouses },
      { data: stops },
      { data: events },
      { data: ledger },
    ] = await Promise.all([
      tenantId ? jobsQ.eq("tenant_id", tenantId) : jobsQ,
      tenantId ? driversQ.eq("tenant_id", tenantId) : driversQ,
      tenantId ? whQ.or(`tenant_id.eq.${tenantId},tenant_id.is.null`) : whQ,
      tenantId ? stopsQ.eq("jobs.tenant_id", tenantId) : stopsQ,
      tenantId ? eventsQ.eq("tenant_id", tenantId) : eventsQ,
      supabaseAdmin.from("driver_day_hours").select("*"),
    ]);

    const jobList = (jobs ?? []) as Job[];
    const driverList = (drivers ?? []) as Driver[];
    const whList = (warehouses ?? []) as Warehouse[];

    // ── 2. Stops map ─────────────────────────────────────────────────────────
    const stopsMap: StopsMap = {};
    for (const s of stops ?? []) {
      (stopsMap[s.job_id as string] ||= []).push({
        kind: s.kind as "PICKUP" | "DROP",
        warehouse_id: s.warehouse_id as string,
        arrived_at: s.arrived_at as string | null,
        scheduled_at: s.scheduled_at as string | null,
      });
    }

    // ── 3. Compliance per driver ──────────────────────────────────────────────
    const eventsByDriver: Record<string, ComplianceEvent[]> = {};
    for (const e of events ?? []) {
      (eventsByDriver[e.driver_id as string] ||= []).push({
        type: e.type as string,
        timestamp: e.timestamp as string,
      });
    }
    const ledgerByDriver: Record<string, { day: string; drive_minutes: number }[]> = {};
    for (const r of ledger ?? []) {
      (ledgerByDriver[r.driver_id as string] ||= []).push({
        day: r.day as string,
        drive_minutes: r.drive_minutes as number,
      });
    }
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const weekAgo = new Date(nowMs - 6 * 86400_000).toISOString().slice(0, 10);
    const fortnightAgo = new Date(nowMs - 13 * 86400_000).toISOString().slice(0, 10);

    const complianceMap: Record<string, ReturnType<typeof computeCompliance>> = {};
    for (const d of driverList) {
      const rows = ledgerByDriver[d.id] ?? [];
      const todayRow = rows.find((r) => r.day === today);
      const weekRows = rows.filter((r) => r.day >= weekAgo && r.day <= today);
      const fortRows = rows.filter((r) => r.day >= fortnightAgo && r.day <= today);
      complianceMap[d.id] = computeCompliance(eventsByDriver[d.id] ?? [], nowMs, {
        daily: todayRow ? todayRow.drive_minutes / 60 : undefined,
        weekly: weekRows.length
          ? weekRows.reduce((s, r) => s + r.drive_minutes, 0) / 60
          : undefined,
        twoWeek: fortRows.length
          ? fortRows.reduce((s, r) => s + r.drive_minutes, 0) / 60
          : undefined,
      });
    }

    // ── 4. Shifts + overrides ─────────────────────────────────────────────────
    const driverIds = driverList.map((d) => d.id);
    let driverShifts: Record<string, DriverShift> = {};
    let allOverrides: DriverAvailabilityOverride[] = [];

    if (driverIds.length > 0) {
      const targetDates = Array.from(
        new Set(jobList.map((j) => j.for_date).filter((d): d is string => d != null)),
      );
      const [shiftsByDriver, { data: overrides }] = await Promise.all([
        fetchShiftsByDriver(supabaseAdmin, driverIds),
        targetDates.length > 0
          ? supabaseAdmin
              .from("driver_availability_overrides")
              .select("*")
              .in("driver_id", driverIds)
              .in("date", targetDates)
          : Promise.resolve({ data: [] }),
      ]);
      driverShifts = shiftsByDriver;
      allOverrides = (overrides ?? []) as DriverAvailabilityOverride[];
    }

    // ── 5. Driver snapshots + eligibility ────────────────────────────────────
    const driverSnapshots: DriverSnapshot[] = [];
    const driverEligibility: DriverEligibilityTrace[] = [];

    // warehouse code lookup
    const whById = new Map(whList.map((w) => [w.id, w]));

    for (const d of driverList) {
      const c = complianceMap[d.id];
      const cap = effectiveDailyCap(c);
      driverSnapshots.push({
        driverId: d.id,
        name: d.name,
        status: d.status,
        lat: d.current_lat,
        lon: d.current_lon,
        daily_hours: c.daily,
        weekly_hours: c.weekly,
        twoWeek_hours: c.twoWeek,
        continuous_drive: c.continuousDrive,
        daily_cap: cap,
        hours_left: Math.max(0, cap - c.daily),
        compliance_block: c.blockAssignment,
        compliance_issues: c.issues.map((i) => `[${i.level}] ${i.msg}`),
      });

      const excluded: string[] = [];
      // Status filter removed: availability is determined by shift schedule only.
      // OFF_SHIFT now = not scheduled today, not = permanently unavailable.
      if (d.current_lat == null || d.current_lon == null) {
        excluded.push("No GPS position");
      }
      if (c.blockAssignment) {
        excluded.push(
          `Compliance block: ${c.issues
            .filter((i) => i.level === "breach")
            .map((i) => i.msg)
            .join("; ")}`,
        );
      }
      if (cap <= 0) {
        excluded.push(
          `Effective daily cap is 0h (weekly=${c.weekly.toFixed(1)}h, 2wk=${c.twoWeek.toFixed(1)}h)`,
        );
      }

      driverEligibility.push({
        driverId: d.id,
        name: d.name,
        eligible: excluded.length === 0,
        reasons_excluded: excluded,
      });
    }

    const eligibleDrivers = driverList.filter(
      (d) => driverEligibility.find((e) => e.driverId === d.id)?.eligible,
    );

    // ── 6. Group jobs by date ─────────────────────────────────────────────────
    const byDate = new Map<string, Job[]>();
    const noDateJobs: Job[] = [];

    for (const job of jobList) {
      if (job.for_date) {
        const bucket = byDate.get(job.for_date) ?? [];
        bucket.push(job);
        byDate.set(job.for_date, bucket);
      } else {
        noDateJobs.push(job);
      }
    }

    // ── 7. Plan each date group with full trace ───────────────────────────────
    const dateGroupTraces: DateGroupTrace[] = [];
    let totalAssigned = 0;
    let totalUnassignable = noDateJobs.length;
    const allUsedDriverIds = new Set<string>();

    for (const [dateStr, dateJobs] of byDate) {
      // Filter eligible drivers for this specific date
      const dateEligible = eligibleDrivers.filter((d) =>
        isDriverAvailableOnDate(d.id, dateStr, driverShifts, allOverrides),
      );
      const eligibleIds = dateEligible.map((d) => d.id);

      // Forecast: initial position/hours for each eligible driver
      const nominalStartMs = new Date(dateStr + "T06:00:00Z").getTime();
      const baseStartMs = Math.max(nominalStartMs, nowMs);

      type TForecast = {
        lat: number;
        lon: number;
        hoursLeft: number;
        sequence: number;
        continuous: number;
      };
      const forecast: Record<string, TForecast> = {};
      for (const d of dateEligible) {
        const c = complianceMap[d.id];
        const cap = effectiveDailyCap(c);
        forecast[d.id] = {
          lat: d.current_lat!,
          lon: d.current_lon!,
          hoursLeft: Math.max(0, cap - c.daily),
          sequence: 0,
          continuous: c.continuousDrive,
        };
      }
      const driverReadyMs: Record<string, number> = {};
      for (const did of eligibleIds) driverReadyMs[did] = baseStartMs;

      // Sort chronologically — same as computePlanForDate
      const pickupMs = (job: Job): number => {
        const s0 = stopsMap[job.id]?.[0];
        const iso = s0?.scheduled_at ?? job.scheduled_at ?? null;
        return iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER;
      };
      const sorted = [...dateJobs].sort((a, b) => pickupMs(a) - pickupMs(b));

      const jobTraces: JobTrace[] = [];

      for (const job of sorted) {
        const stops = stopsMap[job.id] ?? [];
        const fp = firstPickupWh(stops, whList);

        // Build stop summaries
        const stopSummaries = stops.map((s, idx) => ({
          seq: idx + 1,
          kind: s.kind,
          warehouse_code: whById.get(s.warehouse_id)?.code ?? s.warehouse_id,
          scheduled_at: s.scheduled_at ?? null,
        }));

        if (!fp || stops.length === 0) {
          jobTraces.push({
            jobId: job.id,
            reference: job.reference,
            for_date: job.for_date ?? null,
            scheduled_at: job.scheduled_at ?? null,
            stop_count: stops.length,
            stops: stopSummaries,
            first_pickup_warehouse: null,
            job_drive_hours: 0,
            job_wall_hours: 0,
            outcome: "UNASSIGNABLE",
            assigned_driver_id: null,
            assigned_driver_name: null,
            planned_sequence: null,
            planned_start_at: null,
            unassignable_reason: "No stops or pickup warehouse configured",
            candidates: [],
          });
          totalUnassignable++;
          continue;
        }

        const jobH = jobDriveHours(stops, whList);
        const dwellH = stops.reduce((s, st) => s + stopDwellMinutes(st.kind) / 60, 0);
        const jobWallH = jobH + dwellH;

        const schedPickupMs = (() => {
          const iso = stops[0]?.scheduled_at ?? job.scheduled_at ?? null;
          if (!iso) return null;
          const ms = new Date(iso).getTime();
          return Number.isFinite(ms) ? ms : null;
        })();

        const candidates: CandidateEval[] = [];
        let winner: CandidateEval | null = null;
        let nearMissReason: string | null = null;

        for (const did of eligibleIds) {
          const f = forecast[did];
          const driverName = dateEligible.find((d) => d.id === did)?.name ?? did;
          const dist = haversineKm(f.lat, f.lon, fp.latitude, fp.longitude);
          const transit = transitTimeHours(dist);
          const driveAdd = jobH + transit;
          const breakNeeded = f.continuous + driveAdd > BREAK_THRESHOLD_HOURS;
          const breakMs = breakNeeded ? BREAK_DURATION_MINUTES * 60_000 : 0;

          const readyMs = driverReadyMs[did];
          const transitMs = transit * 3_600_000;
          const departMs =
            schedPickupMs !== null ? Math.max(readyMs, schedPickupMs - transitMs) : readyMs;

          let skipReason: string | null = null;

          if (f.hoursLeft < driveAdd + breakMs / 3_600_000) {
            skipReason = `Insufficient hours: needs ${driveAdd.toFixed(2)}h drive + ${(breakMs / 3_600_000).toFixed(2)}h break, only ${f.hoursLeft.toFixed(2)}h left`;
            if (!nearMissReason)
              nearMissReason = `Closest ineligible: ${driverName} — ${skipReason}`;
          }

          const eval_: CandidateEval = {
            driverId: did,
            driverName,
            dist_km: parseFloat(dist.toFixed(3)),
            transit_hours: parseFloat(transit.toFixed(4)),
            drive_add_hours: parseFloat(driveAdd.toFixed(4)),
            hours_left_before: parseFloat(f.hoursLeft.toFixed(4)),
            hours_left_after: parseFloat(Math.max(0, f.hoursLeft - driveAdd).toFixed(4)),
            weekly_before: parseFloat((complianceMap[did]?.weekly ?? 0).toFixed(4)),
            weekly_after: parseFloat(((complianceMap[did]?.weekly ?? 0) + driveAdd).toFixed(4)),
            continuous_before: parseFloat(f.continuous.toFixed(4)),
            break_inserted: breakNeeded,
            depart_ms: departMs,
            depart_iso: new Date(departMs).toISOString(),
            skip_reason: skipReason,
            selected: false,
          };
          candidates.push(eval_);
        }

        // Select winner — closest with no skip_reason
        const validCandidates = candidates.filter((c) => c.skip_reason === null);
        validCandidates.sort((a, b) => a.dist_km - b.dist_km);
        const bestCandidate = validCandidates[0] ?? null;

        let outcome: JobTrace["outcome"] = "UNASSIGNABLE";
        let unassignableReason: string | null = null;
        let assignedDriverId: string | null = null;
        let assignedDriverName: string | null = null;
        let plannedSequence: number | null = null;
        let plannedStartAt: string | null = null;

        if (bestCandidate) {
          bestCandidate.selected = true;
          outcome = "ASSIGNED";
          assignedDriverId = bestCandidate.driverId;
          assignedDriverName = bestCandidate.driverName;

          // Update forecast for chaining
          const f = forecast[bestCandidate.driverId];
          plannedSequence = ++f.sequence;
          plannedStartAt = bestCandidate.depart_iso;

          const breakMs = bestCandidate.break_inserted ? BREAK_DURATION_MINUTES * 60_000 : 0;
          const arrivalMs = bestCandidate.depart_ms + bestCandidate.transit_hours * 3_600_000;
          const pickupStartMs =
            schedPickupMs !== null ? Math.max(arrivalMs, schedPickupMs) : arrivalMs;
          driverReadyMs[bestCandidate.driverId] = pickupStartMs + jobWallH * 3_600_000 + breakMs;

          const ld = lastDropWh(stops, whList);
          f.lat = ld?.latitude ?? f.lat;
          f.lon = ld?.longitude ?? f.lon;
          f.hoursLeft -= bestCandidate.drive_add_hours;
          f.continuous = bestCandidate.break_inserted
            ? Math.max(0, bestCandidate.drive_add_hours - BREAK_THRESHOLD_HOURS)
            : f.continuous + bestCandidate.drive_add_hours;

          totalAssigned++;
          allUsedDriverIds.add(bestCandidate.driverId);
        } else {
          totalUnassignable++;
          unassignableReason =
            nearMissReason ??
            (eligibleIds.length === 0
              ? `No drivers available for ${dateStr}`
              : "No eligible driver passed all filters");
        }

        jobTraces.push({
          jobId: job.id,
          reference: job.reference,
          for_date: job.for_date ?? null,
          scheduled_at: job.scheduled_at ?? null,
          stop_count: stops.length,
          stops: stopSummaries,
          first_pickup_warehouse: fp.code,
          job_drive_hours: parseFloat(jobH.toFixed(4)),
          job_wall_hours: parseFloat(jobWallH.toFixed(4)),
          outcome,
          assigned_driver_id: assignedDriverId,
          assigned_driver_name: assignedDriverName,
          planned_sequence: plannedSequence,
          planned_start_at: plannedStartAt,
          unassignable_reason: unassignableReason,
          candidates,
        });
      }

      dateGroupTraces.push({
        date: dateStr,
        job_count: sorted.length,
        eligible_driver_count: dateEligible.length,
        jobs: jobTraces,
      });
    }

    // ── 8. Assemble report ────────────────────────────────────────────────────

    // Plain-language decision narrative for the AI assistant to graph.
    const eligibleNames = driverEligibility.filter((d) => d.eligible).map((d) => d.name);
    const exp: string[] = [];
    exp.push(
      `Planner audit (${auditRunAt}). ${jobList.length} pending route(s): ${totalAssigned} assigned, ${totalUnassignable} unassignable across ${byDate.size} service date(s).`,
    );
    exp.push(
      `Eligible drivers today: ${eligibleNames.length ? eligibleNames.join(", ") : "none"}.`,
    );
    exp.push(
      "Decision rule: each route is given to the NEAREST eligible driver who fits — within ~30 km of the pickup (or ~80 km when chaining onto an earlier run), inside HGV limits (9h/day, 56h/week, 90h/fortnight) with a 45-minute break per 4.5h driving, inside the driver's shift window, with a reserved return-to-base leg where required, and matching the route's equipment type.",
    );
    for (const g of dateGroupTraces) {
      exp.push(
        `\nDate ${g.date} — ${g.job_count} route(s), ${g.eligible_driver_count} eligible driver(s):`,
      );
      for (const j of g.jobs) {
        if (j.outcome === "ASSIGNED") {
          const win = j.candidates.find((c) => c.selected);
          exp.push(
            `  - ${j.reference} (from ${j.first_pickup_warehouse ?? "?"}) assigned to ${j.assigned_driver_name ?? j.assigned_driver_id ?? "?"} — closest eligible${win ? ` at ${win.dist_km.toFixed(1)} km` : ""}, sequence ${j.planned_sequence ?? "?"}.`,
          );
        } else {
          exp.push(
            `  - ${j.reference} (from ${j.first_pickup_warehouse ?? "?"}) UNASSIGNABLE — ${j.unassignable_reason ?? "no eligible driver"}.`,
          );
        }
      }
    }
    exp.push(
      "\nTo visualise this: for each service date draw a flowchart where every route node points either to its assigned driver (label the arrow with the distance / reason it won) or to an 'Unassignable' node labelled with the blocking reason (hours, distance, shift end, equipment mismatch, or impossible schedule).",
    );
    const aiExplanation = exp.join("\n");

    return {
      audit_run_at: auditRunAt,
      now_ms: nowMs,
      tenant_id: tenantId,
      ai_explanation: aiExplanation,
      constants: {
        auto_assign_radius_km: AUTO_ASSIGN_RADIUS_KM,
        chain_radius_km: CHAIN_RADIUS_KM,
        daily_cap_default: DAILY_CAP_DEFAULT,
        weekly_cap: WEEKLY_CAP,
        break_threshold_hours: BREAK_THRESHOLD_HOURS,
        break_duration_minutes: BREAK_DURATION_MINUTES,
        nominal_start_utc: "06:00:00Z",
        city_speed_kmh: 16.09,
        highway_speed_kmh: 64.37,
        city_distance_km: 12.87,
        arrival_buffer_minutes: ARRIVAL_BUFFER_MINUTES,
        loading_minutes: 30,
        unloading_minutes: 30,
        checks_minutes: 15,
      },
      summary: {
        total_pending_jobs: jobList.length,
        total_no_date_jobs: noDateJobs.length,
        total_assigned: totalAssigned,
        total_unassignable: totalUnassignable,
        drivers_used: allUsedDriverIds.size,
        dates_planned: Array.from(byDate.keys()).sort(),
      },
      driver_snapshots: driverSnapshots,
      driver_eligibility: driverEligibility,
      date_groups: dateGroupTraces,
      non_determinism_warning:
        "IMPORTANT: Running Plan multiple times produces different results because: " +
        "(1) nowMs is captured fresh each call — driver GPS positions and compliance windows shift. " +
        "(2) The drivers table has no ORDER BY — Postgres returns rows in arbitrary heap order. " +
        "When two drivers are equidistant, row order decides the winner. " +
        "(3) compliance.daily/weekly fall back to 0 when a driver has no ledger row for today " +
        "— phantom capacity causes assignments that later runs reverse. " +
        "Fix: add ORDER BY id to all driver queries; use a fixed nowMs seed passed from the client.",
    };
  });
