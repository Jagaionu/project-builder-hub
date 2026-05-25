## What's actually wrong

Copilot's diagnosis is incorrect. The Supabase env vars are present in `.env` (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are both set), and `src/integrations/supabase/client.ts` uses a lazy Proxy — it only throws when something accesses the client, not on import. The black screen is not from a Supabase init error.

The actual server logs show every request to the preview returning **502** with:

```
Error: No such module "h3-v2".
  imported from "server.js"
    at async serveSSR (...)
```

This is a stale server bundle on the edge worker referencing an `h3-v2` virtual module that no longer exists in the current dependency graph. SSR fails before any of our app code runs — which is why the page is black and the console only shows the Lovable wrapper logs, not a real React error.

## Plan

1. Force a fresh production rebuild by making a no-op edit to `src/server.ts` (add a harmless comment). This invalidates the cached bundle that's pinned to the broken `h3-v2` import and produces a clean server entry against the current `@tanstack/react-start` + h3 versions.
2. Wait for the rebuild, then reload the preview URL and confirm SSR returns 200 instead of 502.
3. If the 502 persists after rebuild, inspect `package.json` / lockfile for a version mismatch between `@tanstack/react-start` and its h3 peer and pin/upgrade accordingly.

## Verification

- Reload `id-preview--de24c086-d49f-40b3-b183-98147b9f11b0.lovable.app` — should render the login page, not a 502/black screen.
- Recheck server logs: no more `No such module "h3-v2"` entries.
- No file changes to `src/integrations/supabase/client.ts` are needed (and would not fix this).
