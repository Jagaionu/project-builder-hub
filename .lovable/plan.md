## 1. Finish job detail page — `src/routes/d.routes.$jobId.tsx`

Add the missing pieces to the existing screen (keep what's already there: summary card, timeline, complete button):

- **Status badge in header** — small pill next to the reference using `STATUS_CONFIG` colours imported from `DriverJobCard` (export the map from there if not already). Shows the friendly label (Pending, Assigned, In Progress, etc.).
- **Action bar** — small helper component rendered above the timeline:
  - `ASSIGNED`:
    - **✅ Accept** (`bg-success/20 text-success`):
      `jobs.update({status:"IN_PROGRESS"})` + `drivers.update({status:"ON_ROUTE"})` + `driver_events.insert({type:"ACCEPT_JOB", payload:{job_id}})`. Optimistically update the store job's status so the screen reflects the new state immediately.
    - **❌ Reject** (`bg-destructive/10 text-destructive`):
      `jobs.update({status:"PENDING", assigned_driver_id:null, planned_driver_id:null})` + `driver_events.insert({type:"REJECT_JOB", payload:{job_id}})`. Then `navigate({ to: "/d/routes" })`.
  - `IN_PROGRESS` | `ARRIVED_PICKUP` | `EN_ROUTE_DELIVERY`:
    - **🚫 Can't complete** (muted style):
      Same as Reject but logs `CANT_COMPLETE` and also `drivers.update({status:"AVAILABLE"})`. Navigates back to `/d/routes`.
  - Each action wrapped in a `window.confirm(...)` for Reject / Can't complete, and disabled while in-flight (`useState` busy flag).
- **Notes section** — small `<textarea>` + "Save note" button below the timeline:
  - Inserts `driver_events` row `{ driver_id, type: "DRIVER_NOTE", payload: { job_id, note } }`.
  - Clears the textarea + toast on success.

Concerns:
- `ACCEPT_JOB`, `REJECT_JOB`, `CANT_COMPLETE`, `DRIVER_NOTE` must be valid values for the `driver_event_type` enum in Postgres. If any are missing the insert will 400. Plan: run a quick read against the enum and, if any are missing, add them via migration before wiring the UI.

## 2. DriverStopTimeline

Already matches spec. No changes.

## 3. PWA — `vite.config.ts` + assets + safety guards

**Warning surfaced to user (per Lovable platform guidance):** service workers registered inside Lovable's preview iframe cause stale builds and broken navigation. PWA features (install prompt, offline) will only work on the **published** URL, never inside the editor preview. The config below disables the SW in dev and guards registration so it never runs in the iframe.

### Install + config
- `bun add -d vite-plugin-pwa`
- Update `vite.config.ts` to pass `vite.plugins: [VitePWA({...})]` via the Lovable wrapper's `vite` option (the wrapper already provides tanstackStart/react/etc., so we only add VitePWA).
- VitePWA options:
  ```ts
  VitePWA({
    registerType: 'autoUpdate',
    devOptions: { enabled: false },        // never run in dev/preview
    injectRegister: false,                  // we register manually with iframe guard
    includeAssets: ['favicon.ico', 'icons/*.png'],
    manifest: {
      name: 'Driver App', short_name: 'Driver',
      description: 'Route management for drivers',
      theme_color: '#0f172a', background_color: '#0f172a',
      display: 'standalone', orientation: 'portrait',
      scope: '/d/', start_url: '/d/',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html}'],
      navigateFallback: '/d/',
      navigateFallbackAllowlist: [/^\/d/],
      navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/.*\.supabase\.co\//,
          handler: 'NetworkFirst',
          options: { cacheName: 'supabase-api', networkTimeoutSeconds: 5 },
        },
        {
          urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: { cacheName: 'html', networkTimeoutSeconds: 3 },
        },
      ],
    },
  })
  ```

### Iframe / preview-host guard
Add a small client-only registration helper, called once from `src/routes/__root.tsx` inside a `useEffect`:
- If `window.self !== window.top` (iframe) OR hostname contains `id-preview--` / `lovableproject.com` / `lovable.app` (preview): unregister any existing service workers, do NOT register a new one.
- Otherwise (real published deploy, e.g. driver opened the installed app or a custom domain): import `virtual:pwa-register` and call `registerSW({ immediate: true })`.

### Icons
Generate two PNGs into `public/icons/`:
- `icon-192.png` (192×192)
- `icon-512.png` (512×512, maskable-safe with padding)
Simple "D" mark on `#0f172a` background to match `theme_color`. Generated via `imagegen` (premium for crisp typography).

### Out of scope
- Push notifications.
- Background sync of GPS / events when offline (Supabase calls will fail gracefully when offline; runtime cache covers reads only).
- Install-prompt UI inside the app — relying on the browser's native prompt for now.
