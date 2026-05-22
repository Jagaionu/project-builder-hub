
# Permanent driver pairing codes

Right now the code is single-use and expires after 15 minutes, so the second time the driver tries to log in the endpoint returns "Code not found / already used". We'll change it to a permanent, reusable code that lives on the driver row and never expires.

## 1. Schema (one migration)

- Add `login_code text UNIQUE` directly on `drivers`.
- Backfill: every existing driver gets a fresh 6-digit `login_code` (unique).
- New drivers: a trigger auto-generates a 6-digit `login_code` on insert if not provided.
- Keep `pairing_codes` table around but stop relying on it for login. (Optional cleanup later.)

The code lives on `drivers.login_code` — one code per driver, forever, until you click "Regenerate".

## 2. Login endpoint — `/api/public/pairing-login`

Rewrite the handler to:
1. Read the 6-digit `code` from the request body.
2. Look up `drivers` by `login_code`. If not found → 404 "Code not found".
3. Ensure a hidden `auth.users` row exists for that driver (`driver-<id>@driver.local`), rotate its password.
4. Return `{ email, password }` — the client signs in with that.
5. No "consumed_at", no "expires_at" check. Same code works every time.

CORS: add permissive `Access-Control-Allow-Origin: *` + OPTIONS handler so the separate `build-my-dream-app` frontend can call it cross-origin.

## 3. Dispatch UI — Drivers page

- "App Code" column now shows `drivers.login_code` directly (always present, never blank).
- "Regenerate" button rotates `drivers.login_code` to a new unique 6-digit number (server fn).
- Remove the toast-only flow and the dependency on `pairing_codes` rows for display.
- "Add driver" no longer needs to call `generateDriverPairingCode` — the DB trigger fills it in automatically; we just refetch.

## 4. Driver app (`build-my-dream-app`)

The driver app must POST to **this** project's endpoint:

```
POST https://assemble-joy-maker.lovable.app/api/public/pairing-login
Content-Type: application/json
{ "code": "123456" }
```

…and then call `supabase.auth.signInWithPassword({ email, password })` against **this** project's Supabase URL + publishable key (same Lovable Cloud DB). I'll give you the exact 3-line change for that repo's `driver-auth.ts` (swap the base URL + the Supabase client env vars) — no other change needed there.

If you'd rather skip the separate repo entirely, the `/d/login` route already in this project does the exact same thing on `<this-app>/d/login`.

## 5. What I'm NOT touching

- The dispatch UI (jobs, calendar, live map).
- `pairing_codes` table stays (in case of historical references); it's just no longer the source of truth for login.
- RLS, planner, shift-ledger logic.

## Technical details

- Migration: `ALTER TABLE drivers ADD COLUMN login_code text UNIQUE;` + a `gen_driver_login_code()` plpgsql function (loops on collision) + `BEFORE INSERT` trigger + a one-shot UPDATE for existing rows.
- New server fn `rotateDriverLoginCode({ driverId })` for the Regenerate button.
- `pairing-login.ts` handler: replace `pairing_codes` lookup with `drivers.select('id, user_id, name').eq('login_code', code).maybeSingle()`. Drop consumed/expired branches. Add CORS headers + `OPTIONS` handler.
- `_app.drivers.tsx`: read `login_code` from the driver row; remove `codes` state + `pairing_codes` fetch; call `rotateDriverLoginCode` from the key-icon button.

Reply "go" and I'll run the migration and ship the changes.
