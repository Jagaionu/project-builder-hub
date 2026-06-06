import { sendPositions, type GpsSample } from "@/lib/driver/gps-tracker";

// Parallel GPS path that will drive the native Capacitor tracker. While the
// flag is off (web/production default) it buffers and LOGS ONLY - it does not
// write to driver_positions, so it never double-writes alongside the existing
// useDriverBootstrap insert. Flip VITE_USE_NATIVE_GPS_TRACKER=true in the
// Capacitor build to actually send via the JWT-secured log_gps RPC.
const SHOULD_SEND = (import.meta.env.VITE_USE_NATIVE_GPS_TRACKER as string | undefined) === "true";

let buf: GpsSample[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

async function flush(): Promise<void> {
  if (buf.length === 0) return;
  const batch = buf;
  buf = [];
  if (!SHOULD_SEND) {
    console.log("[gps] dry-run (not sent):", batch.length, "samples", batch);
    return;
  }
  try {
    await sendPositions(batch);
  } catch (e) {
    buf = [...batch, ...buf].slice(-200);
    console.warn("[gps] flush failed; re-queued", e);
  }
}

export const gpsSeam = {
  push(s: GpsSample) {
    buf.push(s);
    if (!timer) timer = setInterval(() => void flush(), 60000);
    if (buf.length >= 25) void flush();
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
    void flush();
  },
};
