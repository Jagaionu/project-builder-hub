/**
 * run-lane-backfill.ts — Run the lane travel times aggregation against the
 * real Supabase project.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/run-lane-backfill.ts
 *
 * Calls the refresh_lane_travel_times() Postgres function via the service_role
 * key. This function is also scheduled hourly via pg_cron (migration #18), but
 * the initial backfill must be triggered manually on first deploy.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log("═".repeat(56));
  console.log("  LANE TRAVEL TIMES — Backfill");
  console.log("═".repeat(56));

  // Check current lane_travel_times count
  const { count: beforeCount } = await admin
    .from("lane_travel_times")
    .select("*", { count: "exact", head: true });

  console.log(`\n  Before: ${beforeCount ?? "?"} rows in lane_travel_times`);

  // Check if driving_legs has data
  const { count: legCount } = await admin
    .from("driving_legs")
    .select("*", { count: "exact", head: true });

  console.log(`  Source: ${legCount ?? "?"} rows in driving_legs\n`);

  if (!legCount || legCount === 0) {
    console.log(
      "  ⚠ driving_legs is empty — no telemetry to aggregate.\n" +
        "  Lane travel times will populate once drivers start recording legs.\n" +
        "  Until then, the planner falls back to haversine (60 km/h avg).",
    );
    return;
  }

  // Call the aggregation function via raw SQL (service_role required)
  const { error } = await admin.rpc("refresh_lane_travel_times");

  if (error) {
    console.error(`  ✗ RPC failed: ${error.message}`);
    console.log("\n  Falling back to direct SQL via REST...");

    // The function exists but may not be accessible via RPC. Try querying.
    const { data, error: sqlErr } = await admin
      .from("lane_travel_times")
      .select("count", { count: "exact", head: true });

    if (sqlErr) {
      console.error(`  ✗ Cannot access lane_travel_times: ${sqlErr.message}`);
    }
  } else {
    const { count: afterCount } = await admin
      .from("lane_travel_times")
      .select("*", { count: "exact", head: true });

    console.log(`  ✓ Backfill complete`);
    console.log(`  After: ${afterCount ?? "?"} rows in lane_travel_times`);
    console.log(`  Added: ${(afterCount ?? 0) - (beforeCount ?? 0)} new aggregate rows`);
  }

  console.log("\n  " + "─".repeat(54));
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
