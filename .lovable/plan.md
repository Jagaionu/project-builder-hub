
# Use the in-project driver app

You picked option 1: drivers log in inside **this** project at `/d/login`. Nothing more to build server-side — that flow already exists and the permanent code we just shipped already works on it. Two small things to do:

## 1. Publish the app (one click, by you)

The `/d/*` routes work in preview, but to send the link to drivers it needs to be on the published URL. Click **Publish** (top right) → **Update**. After that the live driver URL is:

```
https://assemble-joy-maker.lovable.app/d/login
```

That's the link you send each driver — same URL for everyone. Each driver enters their own 6‑digit code from the **App Code** column on the Drivers page.

## 2. Add a "Copy driver link" helper on the Drivers page

Small UI polish so you don't have to remember/type the URL. On the Drivers page:

- A new button near "New Driver": **Copy driver link** → copies `https://<this-app>/d/login` to clipboard.
- On each row, a small 🔗 icon next to the App Code → copies a one-shot message like:
  ```
  Driver login: https://assemble-joy-maker.lovable.app/d/login
  Your code: 482913
  ```
  ready to paste into WhatsApp / SMS.

That's it for code changes. ~10 lines in `src/routes/_app.drivers.tsx`, no schema, no server changes.

## What to do with the other project

`build-my-dream-app` is no longer needed. You can either ignore it or delete it from the Lovable dashboard — drivers will never touch it. Ignore everything its AI told you about `.env` and Supabase URLs; that was its own database, irrelevant to us now.

## How it works end-to-end (recap)

1. You add a driver on the Drivers page → a permanent 6‑digit code is created and copied to your clipboard.
2. You click **Copy driver link** (after this change) and paste the message into WhatsApp/SMS.
3. The driver opens the link on their phone, types their 6 digits, lands on `/d` personalised with their name.
4. From `/d` they can: see today's & tomorrow's jobs, start/end shift, mark "available tomorrow", share live GPS, accept/arrive/depart on stops, report delays.
5. When you assign a job in dispatch, it appears on their phone in real time (Realtime subscription on `jobs`).
6. The same 6‑digit code keeps working forever. If a driver loses their phone, click the 🔑 icon next to them to rotate it.

Reply "go" and I'll add the Copy-link buttons. Or "skip" if you'd rather just publish and send the URL manually.
