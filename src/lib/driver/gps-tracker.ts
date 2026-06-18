import { supabase } from "@/integrations/supabase/client";

// A single GPS sample, normalised to the shape log_gps expects.
export type GpsSample = {
  latitude: number;
  longitude: number;
  time: number; // epoch ms
  accuracy?: number | null;
  speed?: number | null;
  bearing?: number | null;
};

// One seam for both web and native. The native build swaps in a tracker
// backed by @capacitor-community/background-geolocation; the web build uses
// navigator.geolocation. Both feed samples to the same buffer + sender.
export interface GpsTracker {
  start(onSample: (s: GpsSample) => void): void | Promise<void>;
  stop(): void | Promise<void>;
}

// Flush a batch through the JWT-secured log_gps RPC. We POST via the Supabase
// JS client (not the plugin static headers) so the short-lived JWT is
// refreshed for us and auth.uid() is always populated server-side.
export async function sendPositions(samples: GpsSample[]): Promise<number> {
  if (samples.length === 0) return 0;
  const points = samples.map((s) => ({
    latitude: s.latitude,
    longitude: s.longitude,
    time: s.time,
    accuracy: s.accuracy ?? null,
    speed: s.speed ?? null,
    bearing: s.bearing ?? null,
  }));
  // NOTE: `log_gps` is a DB RPC that isn't in the generated Supabase types yet,
  // so the rpc name is cast. Regenerate src/integrations/supabase/types.ts to
  // type this properly.
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc("log_gps", { points });
  if (error) throw error;
  return (data as { inserted?: number } | null)?.inserted ?? 0;
}

// Web implementation: navigator.geolocation.watchPosition.
export function createWebGpsTracker(opts?: { highAccuracy?: boolean }): GpsTracker {
  let watchId: number | null = null;
  return {
    start(onSample) {
      if (typeof navigator === "undefined" || !navigator.geolocation) return;
      if (watchId !== null) return;
      watchId = navigator.geolocation.watchPosition(
        (pos) =>
          onSample({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            time: pos.timestamp,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            bearing: pos.coords.heading,
          }),
        (err) => console.warn("[gps] watch error", err),
        { enableHighAccuracy: opts?.highAccuracy ?? true, maximumAge: 30000, timeout: 20000 },
      );
    },
    stop() {
      if (watchId !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
      watchId = null;
    },
  };
}

// Native placeholder. The device build replaces this with a tracker that calls
// BackgroundGeolocation.addWatcher(...) and maps its Location to GpsSample.
// Kept import-free so the web bundle never pulls in native code.
export function createNativeGpsTracker(): GpsTracker {
  throw new Error("Native GPS tracker is only available in the Capacitor build");
}

// Size/interval batching buffer. Re-queues on failure (best-effort; the native
// plugin owns the durable on-device offline store).
export function createPositionBuffer(opts?: { maxBatch?: number; flushMs?: number }) {
  const maxBatch = opts?.maxBatch ?? 25;
  const flushMs = opts?.flushMs ?? 60000;
  let buf: GpsSample[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const flush = async () => {
    if (buf.length === 0) return;
    const batch = buf;
    buf = [];
    try {
      await sendPositions(batch);
    } catch (e) {
      buf = [...batch, ...buf].slice(-200);
      console.warn("[gps] flush failed; re-queued", e);
    }
  };

  return {
    add(s: GpsSample) {
      buf.push(s);
      if (buf.length >= maxBatch) void flush();
    },
    start() {
      if (!timer) timer = setInterval(() => void flush(), flushMs);
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await flush();
    },
  };
}
