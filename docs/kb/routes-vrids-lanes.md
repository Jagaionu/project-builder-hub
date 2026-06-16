# Routes, VRIDs & Lanes

In The Prime Route a **route**, a **VRID**, and a **lane** all refer to the same
thing: one planned run on the Dispatch board (an origin → destination with
stops). The terms are used interchangeably across the app.

## How do I create a route / add a new lane?

On the **Dispatch** page click **Create route** (top right). Fill in the origin
and destination warehouses, stops, timing, and optionally a driver, then save.
The new route/VRID/lane appears in the queue. (Asking the assistant "create a
route" or "add a lane" gives you a Show-me button straight to it.)

## How do I clone a VRID / duplicate a route?

Open the route in the detail panel and use **Clone**. It creates a copy as a
new VRID (with a new reference) that you can then adjust — handy for repeating a
similar run without re-entering everything.

## How do I delete a VRID / route / lane?

Open the route's **Edit** dialog and use **Delete** (it confirms first —
"Delete this lane? This cannot be undone."). Deleting removes it from the board.

## Is there a way to filter the VRIDs?

Yes — use the **"Filter by reference, driver, status…"** search box at the top of
the Dispatch page. Type a route reference, a driver name, or a status to narrow
the queue. The status counters (Pending / Scheduled / In progress / Completed /
Cancelled) at the top also act as a quick overview.

## What does History do?

**History** opens the **Import History** — the log of past CSV import batches,
so you can see what was imported, when, and re-check or clean up a previous
bulk upload.

## How do I find the closest driver for an ad-hoc job?

On the **Live Map**, click a driver to select them, then click any warehouse —
the map calculates the ad-hoc transit time/ETA from that driver to that
warehouse. Compare a few nearby drivers this way to pick the closest available
one. (The automatic planner also factors in driver location and travel times
when it assigns routes.)
