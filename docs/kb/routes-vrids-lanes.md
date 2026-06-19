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

## How do I delete a single VRID / route / lane?

Open the route's **Edit** dialog and use **Delete** (it confirms first —
"Delete this lane? This cannot be undone."). Deleting removes it from the board.
This is for removing **one** route. To remove a whole imported file at once, use
History (below).

## I uploaded the wrong CSV — how do I delete all the routes I added?

You don't have to delete them one by one. On the **Dispatch** page click
**History** (the Import History). Find the file you imported, then click its
**Delete (trash) button** — it removes **the entire import in one go**: every
VRID/route created from that file. It asks you to confirm ("Delete import
'<file>'? This permanently removes all N job(s) created from this file. This
cannot be undone."). That's the fastest way to undo a wrong upload.

## What does History do?

**History** opens the **Import History** — the log of past CSV import batches.
For each file it shows what was imported and the counts (created / parked /
duplicate / error), and gives you a **Delete button per file** that removes that
whole import (all of its routes) at once. Use it to review or to clean up a
previous bulk upload. (Import batches expire automatically after 14 days.)

## Is there a way to filter the VRIDs?

Yes — use the **"Filter by reference, driver, status…"** search box at the top of
the Dispatch page. Type a route reference, a driver name, or a status to narrow
the queue. The status counters (Pending / Scheduled / In progress / Completed /
Cancelled) at the top also act as a quick overview.

## How do I find the closest driver for an ad-hoc job?

On the **Live Map**, click a driver to select them, then click any warehouse —
the map calculates the ad-hoc transit time/ETA from that driver to that
warehouse. Compare a few nearby drivers this way to pick the closest available
one. (The automatic planner also factors in driver location and travel times
when it assigns routes.)
