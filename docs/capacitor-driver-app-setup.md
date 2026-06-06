# Driver App on Capacitor - Native Setup Guide

Goal: ship the driver UI (the /d/* routes) as a native iOS/Android app with
true background GPS, reusing the existing React code. Do this on a Mac/PC with
Xcode + Android Studio (it cannot be done in the headless dev sandbox).

## Architecture reality (read first)

This repo is a TanStack START app (SSR): it deploys as a serverless function
plus a static client (dist/client), and the dispatcher side uses server
functions. Capacitor, however, loads a STATIC bundle from the device - there is
no SSR server on the phone.

Good news: the driver UI (/d/* routes and src/components/driver/*) uses NO
server functions - every call goes straight to Supabase (auth, data, realtime,
and the log_gps RPC). So the driver app can ship as a pure client SPA that talks
directly to Supabase. Nothing driver-facing needs the SSR server.

IMPORTANT: the earlier suggestion to add a Vite rollupOptions.input for a
src/main_driver.tsx entry does NOT apply here - TanStack Start owns the entry via
its plugin. Use a dedicated SPA build instead (below).

## 1. Driver-only SPA build

Create a second build that emits a static client SPA of the driver routes into
dist/driver (which capacitor.config.ts already points webDir at).

- Enable TanStack Start SPA mode for this build (prerenders an index.html shell
  that boots the router client-side), e.g. a separate vite.config.driver.ts that
  extends the base config and sets the Start plugin spa option, with build output
  dir dist/driver. Keep the existing SSR vite.config.ts UNCHANGED so the
  dispatcher deploy on Vercel is unaffected.
- The router should land on /d on launch (the PWA navigateFallback is already /d).
- Validate the SPA build in a browser (serve dist/driver statically) BEFORE
  wrapping it in Capacitor.

Note: the existing vite-plugin-pwa service worker is for the web PWA. Inside the
Capacitor shell you generally do not want the SW intercepting; scope it out of
the driver SPA build or disable it for the native target.

## 2. Add Capacitor + the plugin

```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android \
  @capacitor-community/background-geolocation
npm run build:driver        # produces dist/driver (the SPA build script you add)
npx cap add ios
npx cap add android
npx cap sync
```
capacitor.config.ts is already committed (appId com.primeroute.driver, webDir
dist/driver, no service-role key).

## 3. Implement the native tracker

Replace the createNativeGpsTracker stub in src/lib/driver/gps-tracker.ts with the
real implementation (only in the native build - it imports the plugin, which is
not installed in the web app, so keep it behind the build that has the dep):

```ts
import { BackgroundGeolocation } from "@capacitor-community/background-geolocation";
import type { GpsTracker, GpsSample } from "@/lib/driver/gps-tracker";

export function createNativeGpsTracker(): GpsTracker {
  let watcherId: string | null = null;
  return {
    async start(onSample: (s: GpsSample) => void) {
      watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: "PrimeRoute",
          backgroundMessage: "Tracking your deliveries",
          requestPermissions: true,
          stale: false,
          distanceFilter: 30,
        },
        (location, error) => {
          if (error || !location) return;
          onSample({
            latitude: location.latitude,
            longitude: location.longitude,
            time: location.time ?? Date.now(),
            accuracy: location.accuracy,
            speed: location.speed,
            bearing: location.bearing,
          });
        },
      );
    },
    async stop() {
      if (watcherId) await BackgroundGeolocation.removeWatcher({ id: watcherId });
      watcherId = null;
    },
  };
}
```

Wire start/stop to the shift lifecycle (start on shift begin, stop on shift end)
and feed each sample to gpsSeam.push so it batches through log_gps.

## 4. Turn on real sending

The seam is dry-run by default (logs only, never writes). For the native build,
set the flag so it sends via the JWT-secured log_gps RPC:

```bash
VITE_USE_NATIVE_GPS_TRACKER=true npm run build:driver
```

## 5. iOS permissions (ios/App/App/Info.plist)

```xml
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>We track your location during a shift to manage deliveries.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Location is used to show your current route.</string>
<key>UIBackgroundModes</key>
<array><string>location</string></array>
```

## 6. Test + ship

Run docs/capacitor-gps-test-checklist.md on real devices, then submit to
App Store / Play. Keep tracking shift-gated (no startOnBoot/stopOnTerminate) for
consent reasons.

## What is already done in this repo

- log_gps RPC (migration 28) - secure, identity from auth.uid(), live in the DB.
- src/lib/driver/gps-tracker.ts - seam + web impl + native stub + batched send.
- src/lib/driver/gps-seam.ts - flag-gated buffer (dry-run until the flag is set).
- useDriverBootstrap feeds samples to the seam; existing insert untouched.
- capacitor.config.ts (driver-only, no service key, shift-gated).

## Status: driver SPA build is implemented and verified

`vite.config.driver.ts` + `npm run build:driver` now exist and build cleanly in
this repo (TanStack Start SPA mode, maskPath /d, PWA service worker stubbed out).
It emits a static client to `dist/driver/` with a root `index.html` (the SPA
shell) plus hashed assets - exactly what Capacitor `webDir` expects. The main SSR
`vite.config.ts` and the Vercel deploy are untouched (tsc + npm run build verified
green).

```bash
npm run build:driver     # -> dist/driver/ (static SPA, gitignored)
# sanity check in a browser before Capacitor:
npx serve dist/driver     # open the served URL, then navigate to /d
```

### One native wiring detail still to handle (needs a device/browser to verify)

The shell boots the router at `/` (in the Capacitor shell the start URL is
`capacitor://localhost/`). The driver app should land on `/d`. Pick one:
- Add a `/` -> `/d` redirect in the driver build (a small index route redirect),
  or
- Configure the initial path in the native layer.
This is the last routing detail; it cannot be fully verified headless, so confirm
it when you first run the app on a simulator/device.
