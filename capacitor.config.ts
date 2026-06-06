import type { CapacitorConfig } from "@capacitor/cli";

// Driver-only Capacitor shell (webDir points at the driver-only Vite build).
// IMPORTANT: no BackgroundGeolocation url/httpHeaders here. GPS batches are
// POSTed from JS via the Supabase client (log_gps RPC) so the short-lived JWT
// refreshes itself and auth.uid() is always set server-side. NEVER put the
// service-role key in this file - it would ship inside the app binary.
// Tracking is shift-gated in code (start/stop), so no startOnBoot/stopOnTerminate.
const config: CapacitorConfig = {
  appId: "com.primeroute.driver",
  appName: "PrimeRoute Driver",
  webDir: "dist/driver",
};

export default config;
