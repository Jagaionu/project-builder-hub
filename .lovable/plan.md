## Goal

Turn the existing Telegram bot into a fully two‑way driver app: dispatch assigns → driver gets a push with buttons → driver acts (accept, share location, picked up, delivered, delay, end shift) → app reflects it live. Also add a self‑link onboarding flow and register the webhook now so it goes live.

## What's already in place (no rework needed)

- Reply keyboard: Start Shift · Share Location · My Jobs · Report Delay · End Shift
- Inline per‑job buttons: Accept · Reject · Picked up · Delivered
- Location ingestion + geofence arrival (auto `ARRIVED_PICKUP` / `COMPLETED`)
- ETA recalc on every ping
- Webhook secret verification, `driver_events` logging

## Changes

### 1. Auto‑push assignments (app → driver)

Trigger when a job's `assigned_driver_id` is set or changed in dispatch.

- New server function `notifyDriverOfJob(jobId)` — loads job + driver + warehouses, sends the same formatted card + Accept/Reject/Picked/Delivered inline keyboard via the Telegram gateway.
- Call it from the **Jobs page** wherever a driver is assigned (the existing Create Route dialog and any driver‑change dropdown) right after the Supabase update succeeds. No DB triggers needed — keeps logic in one place and works with the current `public-all` RLS.
- Also push on important status changes the dispatcher makes manually (e.g. CANCELLED → "Job cancelled by dispatch").

### 2. Self‑link with a 6‑digit code

- Migration: add `pairing_code TEXT` and `pairing_expires_at TIMESTAMPTZ` to `drivers`.
- Drivers page: "Generate code" button per row → writes a fresh 6‑digit code valid for 15 min and shows it for the dispatcher to text/whatsapp to the driver.
- In the bot, when an unregistered chat sends a numeric 6‑digit message, the webhook looks it up, sets that driver's `telegram_id` to the chat id, clears the code, and replies with the main menu and "✅ Linked as <name>".
- `/start` from a still‑unregistered chat replies "Send the 6‑digit code your dispatcher gave you."

### 3. One‑tap location (already correct shape)

Keep the current behaviour: 📍 Share Location button uses Telegram's native `request_location`, one tap per request. After Start Shift the bot explicitly nudges: "Please tap 📍 Share Location to start receiving jobs," and again whenever a job is accepted.

### 4. Register the webhook during implementation

Run `setWebhook` against the project's stable dev URL (`project--<id>-dev.lovable.app/api/public/telegram/webhook`) using the existing `registerTelegramWebhook` server fn, then `getWebhookInfo` to confirm. Surface result in chat.

### 5. Small polish

- On `ACCEPT`, also DM a Google Maps deep link to the origin warehouse coordinates.
- On `ARRIVED_PICKUP`, prompt "Tap 🚚 Picked up when loaded."
- On `COMPLETED`, set driver back to `AVAILABLE` and push "✅ Done. Waiting for next job."

## Technical notes

- New file `src/lib/telegram-notify.functions.ts` exposes `notifyDriverOfJob` (server fn, uses `supabaseAdmin` + the existing `telegram.server.ts` helpers).
- Webhook handler (`src/routes/api/public/telegram/webhook.ts`) gains a branch: if `message.text` matches `^\d{6}$` and the chat is unregistered, try to pair.
- Jobs page calls `notifyDriverOfJob` after `supabase.from('jobs').update/insert(...).select().single()` when `assigned_driver_id` is present.
- Migration adds two nullable columns to `drivers`; no RLS change needed.

## Out of scope (say if you want them)

- Driving‑hours / HOS compliance checks
- Live‑location streaming subscription (15 min – 8 h pin)
- Multi‑language bot replies
- Photo proof of delivery