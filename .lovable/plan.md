
# Merge driver app into dispatch — replace Telegram

The driver app from `build-my-dream-app` becomes a set of mobile routes inside this project, sharing the same Lovable Cloud database. Telegram is removed. Drivers log in with the 6-digit pairing code already generated on the Drivers page.

## End state

One project, one database, two surfaces:

- **Dispatch (web)** — current routes under `/_app/*` (jobs, drivers, dispatch, live map, alerts, warehouses, events). Used by you on desktop.
- **Driver (mobile)** — new routes under `/d/*` (login, home/shift, routes list, job detail, report, profile). What each driver opens on their phone.

Telegram webhook, bot menu, registration flow, and job-card sender are deleted.

## Routes & files added

```text
src/routes/
  d.tsx                     // pathless mobile layout: dark theme, bottom nav, GPS hook, requires session
  d.index.tsx               // Home: greeting, shift toggle, "available tomorrow", today's jobs
  d.routes.tsx              // List of assigned routes (today + tomorrow)
  d.routes.$jobId.tsx       // Job detail: stop timeline, accept/reject, arrive/depart, complete
  d.report.tsx              // Report delay/incident
  d.profile.tsx             // Driver info + sign out
  d.login.tsx               // 6-digit pairing-code entry (public)
  api/public/pairing-login.ts  // Exchanges code for a Supabase session

src/components/driver/
  BottomNav.tsx
  JobCard.tsx
  StopTimeline.tsx

src/lib/
  driver-auth.ts            // loginWithPairingCode, logout
  driver-store.ts           // Zustand store: driver, jobs, gps, isOnline
  gps.ts                    // Geolocation watcher → driver_positions insert
```

Driver routes use only the driver app's mobile design tokens (already in its `styles.css` — we'll port `--accent`, `--card`, `--text-muted`, etc. as new tokens scoped to `.driver-theme` on the `/d/*` layout so the dispatch UI is untouched).

## Schema changes (single migration)

Adapt the driver app's needs onto this project's existing tables so we keep one schema:

1. **`drivers`**
   - Add `user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE` (nullable, populated on first pairing-code login).
   - Keep existing fields. Drop `telegram_id` later in a cleanup migration (kept for now to avoid breaking history).

2. **New `pairing_codes` table** — server-only (RLS deny-all):
   ```text
   code text PK, driver_id uuid FK, expires_at timestamptz, consumed_at timestamptz, created_at
   ```
   The existing `drivers.pairing_code` / `pairing_expires_at` columns are deprecated in favor of this table (one driver can have an active rotating code without losing history). The "Generate pairing code" button on the Drivers page writes here.

3. **New `driver_positions` table** for GPS breadcrumbs:
   ```text
   id, driver_id, lat, lon, created_at
   ```
   RLS: driver inserts/reads own rows; dispatch (no auth context yet) keeps the "public all" policy you already use on every other table.

4. **Helper function `public.current_driver_id()`** → `SELECT id FROM drivers WHERE user_id = auth.uid()`. Used by future tighter RLS, harmless today.

5. **Realtime** — add `jobs`, `job_stops`, `drivers` to `supabase_realtime` publication so the driver app receives live updates.

No changes to `jobs` / `job_stops` shape — the driver app code is adapted to use `assigned_driver_id` and `job_stops` (your names), not its own `driver_id` / `stops`.

## Pairing-code login flow

1. Dispatch: on the Drivers page, click "Generate code" → server fn inserts a 6-digit code into `pairing_codes` with `expires_at = now() + 15 min`. The modal shows the code; you read it to the driver.
2. Driver opens `https://<app>/d/login`, enters the 6 digits.
3. `POST /api/public/pairing-login` (already-designed handler from the driver repo, adapted):
   - Validates code, finds driver, ensures a hidden `auth.users` row exists (`driver-<id>@driver.local`), rotates its password.
   - Returns `{ email, password }` to the client, which calls `supabase.auth.signInWithPassword`.
   - Marks the code consumed.
4. Session persists in localStorage; `/d/*` layout redirects to `/d/login` if no session.

This is the only way drivers authenticate. Email/password and Google are not exposed on `/d/*`.

## Telegram removal

Delete:
- `src/routes/api/public/telegram/webhook.ts`
- `src/lib/telegram.server.ts`
- `src/lib/telegram-notify.functions.ts`
- `src/lib/registrations.functions.ts`
- Telegram-related imports in `src/lib/tomorrow.functions.ts` (replace `notifyDriverTomorrowRoutes` with a no-op or a future in-app push — see "Notifications" below).
- The "Telegram ID", `pendingTomorrowState`, and registration UI bits from `_app.drivers.tsx`.

Keep `TELEGRAM_API_KEY` secret in place until you confirm the merge works, then remove the connector.

## Notifications

Telegram is gone, so "your route is assigned" notifications move into the driver app:

- When the driver app is open, realtime subscription on `jobs WHERE assigned_driver_id = me` shows new offers instantly.
- When closed, we add a lightweight **toast + in-app inbox** (a `driver_notifications` table, RLS-scoped, read on `/d/`). Push notifications (FCM/web push) are out of scope for this phase — flagged as a follow-up.

`planTomorrow()` keeps writing `planned_driver_id` etc.; the driver simply opens the app the next morning and sees their routes. No silent failures.

## What I will NOT touch

- Dispatch UI styling, sidebar, calendar work you just polished.
- `planner.ts`, `compliance.ts`, `shift-ledger.*` business logic.
- Existing job creation / CSV import / `sync_job_for_date` trigger.

## Open questions to confirm before I build

1. **Domain** — drivers visit `<your-app>/d/login`, or do you want a separate published URL? (Same project either way, just a routing detail.)
2. **Demo code 123456** — keep as a permanent test code (driver app currently does) or only real generated codes?
3. **Real-time GPS** — driver app sends GPS every 30s into `driver_positions` and also updates `drivers.current_lat/lon`. Confirm that volume is OK (≈2,800 rows/driver/day).

Reply and I'll execute the migration + code changes in one pass.
