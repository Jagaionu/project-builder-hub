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

export type JobCard = { text: string; pickup?: Wh; drop?: Wh };

export async function buildJobCard(jobId: string, driverId?: string): Promise<JobCard | null> {
  const { data: job } = await supabaseAdmin
    .from("jobs")
    .select("id,reference,status,origin_warehouse_id,destination_warehouse_id,scheduled_at,assigned_driver_id,eta_minutes")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const [{ data: o }, { data: d }] = await Promise.all([
    supabaseAdmin.from("warehouses").select("id,code,name,address,latitude,longitude").eq("id", job.origin_warehouse_id).maybeSingle(),
    supabaseAdmin.from("warehouses").select("id,code,name,address,latitude,longitude").eq("id", job.destination_warehouse_id).maybeSingle(),
  ]);

  let driverLat: number | null = null;
  let driverLon: number | null = null;
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

  const distLeg2 = o && d ? haversineKm(o.latitude, o.longitude, d.latitude, d.longitude) : 0;
  const leg2Min = o && d ? etaMinutes(distLeg2) : 0;

  let leg1Min: number | null = null;
  let distLeg1: number | null = null;
  if (o && driverLat != null && driverLon != null) {
    distLeg1 = haversineKm(driverLat, driverLon, o.latitude, o.longitude);
    leg1Min = etaMinutes(distLeg1);
  }

  const when = job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "ASAP";

  const lines: string[] = [];
  lines.push(`🚚 <b>${job.reference}</b> · ${job.status}`);
  lines.push(`🕒 Scheduled: ${when}`);
  lines.push("");
  if (o) {
    lines.push(`📦 <b>Pickup — ${o.code} ${o.name}</b>`);
    if (o.address) lines.push(`📍 ${o.address}`);
    lines.push(`🗺 https://maps.google.com/?q=${o.latitude},${o.longitude}`);
  }
  if (leg1Min != null && distLeg1 != null) {
    lines.push(`➡️ To pickup: ${distLeg1.toFixed(1)} km · ${fmtMin(leg1Min)} (ETA ~${fmtClock(leg1Min)})`);
  } else {
    lines.push(`➡️ To pickup: share 📍 location to compute ETA`);
  }
  lines.push("");
  if (d) {
    lines.push(`🏁 <b>Drop — ${d.code} ${d.name}</b>`);
    if (d.address) lines.push(`📍 ${d.address}`);
    lines.push(`🗺 https://maps.google.com/?q=${d.latitude},${d.longitude}`);
  }
  lines.push(`⏳ Loading: ${LOADING_MINUTES} min`);
  if (o && d) {
    lines.push(`🛣 Pickup → Drop: ${distLeg2.toFixed(1)} km · ${fmtMin(leg2Min)}`);
  }
  if (leg1Min != null) {
    const total = leg1Min + LOADING_MINUTES + leg2Min;
    lines.push(`🏁 ETA at drop: ~${fmtClock(total)} (total ${fmtMin(total)})`);
  } else if (o && d) {
    const total = LOADING_MINUTES + leg2Min;
    lines.push(`🏁 Drop ETA from pickup: ${fmtMin(total)} (incl. loading)`);
  }

  return {
    text: lines.join("\n"),
    pickup: o ?? undefined,
    drop: d ?? undefined,
  };
}
