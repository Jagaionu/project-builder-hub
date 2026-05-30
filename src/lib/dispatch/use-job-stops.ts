import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Stop = {
  id?: string;
  kind: "PICKUP" | "DROP";
  warehouse_id: string;
  scheduled_at: string | null;
  arrived_at?: string | null;
};

type StopRow = {
  id: string;
  job_id: string;
  kind: "PICKUP" | "DROP";
  warehouse_id: string;
  scheduled_at: string | null;
  arrived_at: string | null;
  seq: number;
};

export type JobStopsMap = Record<string, Stop[]>;

// Module-level cache so route remounts don't flash empty state.
let cache: JobStopsMap = {};
const subscribers = new Set<(m: JobStopsMap) => void>();
function broadcast(next: JobStopsMap) {
  cache = next;
  for (const fn of subscribers) fn(next);
}

function rowToStop(s: StopRow): Stop & { seq: number } {
  return {
    id: s.id,
    kind: s.kind,
    warehouse_id: s.warehouse_id,
    scheduled_at: s.scheduled_at,
    arrived_at: s.arrived_at,
    seq: s.seq,
  };
}

/**
 * Loads job_stops once, then applies INSERT / UPDATE / DELETE realtime
 * payloads incrementally. Avoids re-downloading the entire table on every
 * mutation (the previous version did a full SELECT on each change).
 *
 * Stops are kept sorted by `seq` ascending per job — the planner and
 * detail panel rely on positional indexing.
 */
/**
 * Explicit refetch of all job stops. Used after server-side bulk writes
 * (CSV import, Plan) where the Supabase realtime echo can't be relied on.
 * Mirrors the initial load query and fans out to every useJobStops() consumer.
 */
export async function reloadJobStops() {
  // Bounded window: stops scheduled in the last 30 days, plus any without
  // a scheduled_at (unscheduled / brand-new imports). Mirrors useJobs()
  // so we don't pull stops for jobs we'll never display.
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("job_stops")
    .select("id,job_id,kind,warehouse_id,scheduled_at,arrived_at,seq")
    .or(`scheduled_at.gte.${since},scheduled_at.is.null`)
    .order("seq", { ascending: true })
    .limit(5000);
  if (error || !data) return;
  const m: JobStopsMap = {};
  for (const row of data as StopRow[]) {
    (m[row.job_id] ||= []).push(rowToStop(row));
  }
  broadcast(m);
}

export function useJobStops(): JobStopsMap {
  const [map, setMap] = useState<JobStopsMap>(cache);

  useEffect(() => {
    subscribers.add(setMap);
    void reloadJobStops();

    const channel = supabase
      .channel(`rt-stops-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_stops" }, (payload) => {
        const row = payload.new as StopRow;
        const next: JobStopsMap = { ...cache };
        const existing = (next[row.job_id] ?? []) as Array<Stop & { seq?: number }>;
        // Dedupe by id — multiple useJobStops() consumers each subscribe to
        // realtime, so the same INSERT can be delivered N times. Without this
        // guard the row gets appended once per active subscription.
        if (existing.some((s) => s.id === row.id)) return;
        const list: Array<Stop & { seq?: number }> = [...existing, rowToStop(row)]
          .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        next[row.job_id] = list.map(({ seq: _seq, ...rest }) => rest);
        broadcast(next);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "job_stops" }, (payload) => {
        const row = payload.new as StopRow;
        const next: JobStopsMap = { ...cache };
        const list = next[row.job_id] ?? [];
        next[row.job_id] = list.map((s) => (s.id === row.id ? rowToStop(row) : s));
        broadcast(next);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "job_stops" }, (payload) => {
        const row = payload.old as StopRow;
        const next: JobStopsMap = { ...cache };
        const list = (next[row.job_id] ?? []).filter((s) => s.id !== row.id);
        if (list.length) next[row.job_id] = list;
        else delete next[row.job_id];
        broadcast(next);
      })
      .subscribe();

    return () => {
      subscribers.delete(setMap);
      void supabase.removeChannel(channel);
    };
  }, []);

  return map;
}
