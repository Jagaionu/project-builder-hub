## What's happening

Ionut's compliance card shows `BREACH`. The rule that's firing is **"Insufficient rest (≈0h < 9h)"**, not weekly/daily/drive-cycle. So the maths is doing what it's told — the input data is wrong.

## Root cause

When Telegram's webhook was re-registered earlier today, the pending queue flushed and replayed several shift toggles within ~2 seconds. Ionut's `driver_events` now contains:

```text
20:11:58.570  START_SHIFT
20:11:58.927  START_SHIFT     ← duplicate (folded)
20:11:59.304  LOCATION_UPDATE
20:11:59.783  END_SHIFT       ← closes a 1.2-second "shift"
20:12:00.165  START_SHIFT     ← the real current shift
```

`buildSegments` in `src/lib/compliance.ts` produces:

- a closed segment 20:11:58.57 → 20:11:59.78 (1.2 seconds)
- an open segment 20:12:00.16 → now

The compliance rule then computes
`restHours = openShiftStart − previousShiftEnd ≈ 0.4 seconds`,
which is `< 9h`, so it raises a **breach**.

The earlier real shift (14:44 → 17:48) gave him 2h24m of rest before 20:12, which would already trip the "<9h" rest rule, but the phantom 1-second segment is what's actually being compared against.

## Why it shows up as "everything seems right"

In the UI he looks fine — on shift, ~1h driven today, well under all caps. The breach is purely an artefact of (a) Telegram replaying queued events and (b) the compliance code treating any END_SHIFT/START_SHIFT pair as a real driving shift, no matter how short.

## Plan

Two surgical fixes, no schema or business-logic change.

### 1. Ignore degenerate shift segments in compliance (`src/lib/compliance.ts`)

In `buildSegments`, drop any closed segment shorter than a small threshold (e.g. 60 seconds). Rationale: a "shift" under a minute can't represent real driving and is almost always a webhook replay, double-tap, or accidental END→START bounce. This also makes `restHours` ignore the phantom segment and correctly compare against the previous *real* shift end (17:48 → 20:12 = 2.4h, which is still a legitimate `warn`/`breach` depending on policy, but at least based on real data).

### 2. Debounce shift toggles at the webhook (`src/routes/api/public/telegram/webhook.ts`)

Before inserting a `START_SHIFT` or `END_SHIFT` event, look up the most recent shift event for that driver. If it's the same type within the last ~10 seconds, skip the insert. If it's the opposite type within the last ~30 seconds, also skip (prevents a START→END→START bounce from the queue flush). This stops the bad data from being recorded in the first place.

### 3. One-off cleanup for Ionut's current rows

Insert a corrective record? No — `driver_events` is append-only and the public table only allows `select`/`insert` via psql. Instead, the threshold filter in step 1 makes the existing rows benign without a migration. We can leave history as-is.

## Technical details

- File: `src/lib/compliance.ts` — add `MIN_SEG_MS = 60_000`; filter `segs` after building.
- File: `src/routes/api/public/telegram/webhook.ts` — before each shift-event insert, `SELECT type, timestamp FROM driver_events WHERE driver_id=$1 AND type IN ('START_SHIFT','END_SHIFT') ORDER BY timestamp DESC LIMIT 1` and apply the debounce rule above.
- No DB migration, no UI change, no behaviour change for healthy data.

## Out of scope

- Reworking the rest-hours rule itself (2.4h is still under 9h, so once the phantom segment is filtered out, the badge may show `warn` rather than `ok` — that's correct behaviour, not a bug). If you want a different policy here (e.g. allow split shifts within a day), say so and I'll add it.
