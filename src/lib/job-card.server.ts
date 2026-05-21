import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { etaMinutes, haversineKm, LOADING_MINUTES } from "./geo";

type Wh = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
};

type StopRow = {
  id: string;
  seq: number;
  kind: "PICKUP" | "DROP";
  warehouse_id: string;
  scheduled_at: string | null;
  arrived_at: string | null;
};

function fmtMin(total: number) {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtClock(addMin: number) {
  const d = new Date(Date.now() + addMin * 60_000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function getJobStops(jobId: string): Promise<StopRow[]> {
  const { data } = await supabaseAdmin
    .from("job_stops")
    .select("id,seq,kind,warehouse_id,scheduled_at,arrived_at")
    .eq("job_id", jobId)
    .order("seq", { ascending: true });
  return (data ?? []) as StopRow[];
}

export async function buildJobCard(
  jobId: string,
  driverId?: string,
  startLat?: number,
  startLon?: number,
): Promise<{ text: string } | null> {
  const { data: job } = await supabaseAdmin
    .from("jobs")
    .select("id,reference,status,assigned_driver_id,scheduled_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const stops = await getJobStops(jobId);
  if (stops.length === 0) return { text: `<b>${job.reference}</b> · ${job.status}\n(No stops configured)` };

  const whIds = Array.from(new Set(stops.map((s) => s.warehouse_id)));
  const { data: whs } = await supabaseAdmin
    .from("warehouses")
    .select("id,code,name,address,latitude,longitude")
    .in("id", whIds);
  const whMap = new Map<string, Wh>(((whs ?? []) as Wh[]).map((w) => [w.id, w]));

  let driverLat: number | null = null;
  let driverLon: number | null = null;
  if (startLat != null && startLon != null) {
    driverLat = startLat;
    driverLon = startLon;
  } else {
    const targetDriver = driverId ?? job.assigned_driver_id ?? null;
    if (targetDriver) {
      const { data: dr } = await supabaseAdmin
        .from("drivers")
        .select("current_lat,current_lon")
        .eq("id", targetDriver)
        .maybeSingle();
      driverLat = dr?.current_lat ?? null;
      driverLon = dr?.current_lon ?? null;
    }
  }

  const when = job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "ASAP";
  const lines: string[] = [];
  lines.push(`🚚 <b>${job.reference}</b> · ${job.status}`);
  lines.push(`🕒 Scheduled: ${when}`);
  const chain = stops.map((s) => whMap.get(s.warehouse_id)?.code ?? "?").join(" → ");
  lines.push(`🧭 Route: <b>${chain}</b>`);
  lines.push("");

  let cumulativeMin = 0;
  let prevLat = driverLat;
  let prevLon = driverLon;
  const haveStart = prevLat != null && prevLon != null;

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const wh = whMap.get(s.warehouse_id);
    if (!wh) continue;

    let legMin: number | null = null;
    let legKm: number | null = null;
    if (prevLat != null && prevLon != null) {
      legKm = haversineKm(prevLat, prevLon, wh.latitude, wh.longitude);
      legMin = etaMinutes(legKm);
      cumulativeMin += legMin;
    }

    const kindIcon = s.kind === "PICKUP" ? "📦" : "🏁";
    const label = s.kind === "PICKUP" ? "Pickup" : "Drop";
    const stopHeader = `${kindIcon} <b>Stop ${i + 1} — ${label} ${wh.code} ${wh.name}</b>`;
    lines.push(stopHeader);
    if (wh.address) lines.push(`📍 ${wh.address}`);
    lines.push(`🗺 https://maps.google.com/?q=${wh.latitude},${wh.longitude}`);
    if (s.arrived_at) {
      lines.push(`✅ Arrived ${new Date(s.arrived_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    } else if (legMin != null && legKm != null) {
      lines.push(`🕒 <b>${wh.code} ETA ${fmtClock(cumulativeMin)}</b> · ${fmtMin(legMin)} (${legKm.toFixed(1)} km)`);
    } else if (i === 0 && !haveStart) {
      lines.push(`🕒 ${wh.code} ETA — share 📍 location to compute`);
    } else {
      lines.push(`🕒 ${wh.code} ETA — pending location`);
    }

    if (s.kind === "PICKUP") {
      cumulativeMin += LOADING_MINUTES;
      lines.push(`⏳ Loading: ${LOADING_MINUTES} min`);
    }
    lines.push("");

    prevLat = wh.latitude;
    prevLon = wh.longitude;
  }

  if (haveStart) {
    lines.push(`🏁 Total: ${fmtMin(cumulativeMin)} — ETA at final stop ~${fmtClock(cumulativeMin)}`);
  } else {
    lines.push(`🏁 Total drive + ${LOADING_MINUTES}m/pickup loading: ${fmtMin(cumulativeMin)} (from first stop)`);
  }

  return { text: lines.join("\n") };
}
