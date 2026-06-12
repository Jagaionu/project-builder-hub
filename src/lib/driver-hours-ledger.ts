// HGV driving-hours ledger (daily / weekly / fortnightly) for the planner,
// computed over FIXED Mon–Sun weeks. Approved weekly tachograph totals override
// our chain estimate for completed weeks (driver_week_hours); the current week
// and the daily figure always use the estimate (driver_day_hours.drive_minutes).
import type { LedgerTotals } from "@/lib/compliance";
import { weekStartOf, addWeeks, ukToday } from "@/lib/week";

type AnySupabase = { from: (table: string) => any };

export async function buildHoursLedger(
  client: AnySupabase,
  driverIds: string[],
  nowMs: number = Date.now(),
): Promise<Record<string, LedgerTotals>> {
  const out: Record<string, LedgerTotals> = {};
  if (driverIds.length === 0) return out;
  for (const id of driverIds) out[id] = { daily: 0, weekly: 0, twoWeek: 0 };

  const today = ukToday(nowMs);
  const thisWk = weekStartOf(today);
  const lastWk = addWeeks(thisWk, -1);

  const [{ data: dayRows }, { data: weekRows }] = await Promise.all([
    client
      .from("driver_day_hours")
      .select("driver_id,day,drive_minutes")
      .in("driver_id", driverIds)
      .gte("day", lastWk),
    client
      .from("tachograph_requests")
      .select("driver_id,period_start,drive_minutes,status")
      .in("driver_id", driverIds)
      .eq("status", "submitted")
      .gte("period_start", lastWk),
  ]);

  const est: Record<string, Record<string, number>> = {};
  const todayMin: Record<string, number> = {};
  for (const r of (dayRows ?? []) as Array<{
    driver_id: string;
    day: string;
    drive_minutes: number | null;
  }>) {
    const wk = weekStartOf(r.day);
    est[r.driver_id] ||= {};
    est[r.driver_id][wk] = (est[r.driver_id][wk] ?? 0) + (r.drive_minutes ?? 0);
    if (r.day === today)
      todayMin[r.driver_id] = (todayMin[r.driver_id] ?? 0) + (r.drive_minutes ?? 0);
  }
  const approved: Record<string, Record<string, number>> = {};
  for (const w of (weekRows ?? []) as Array<{
    driver_id: string;
    period_start: string;
    drive_minutes: number;
  }>) {
    (approved[w.driver_id] ||= {})[w.period_start] = w.drive_minutes;
  }

  for (const id of driverIds) {
    const wk = (s: string) => approved[id]?.[s] ?? est[id]?.[s] ?? 0;
    out[id] = {
      daily: (todayMin[id] ?? 0) / 60,
      weekly: wk(thisWk) / 60,
      twoWeek: (wk(thisWk) + wk(lastWk)) / 60,
    };
  }
  return out;
}
