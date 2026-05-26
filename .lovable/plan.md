
## What's actually broken

Two separate issues — the Cloudflare AI conflated them.

### 1. The published site is 500ing (this is the real bug)

`https://assemble-joy-maker.lovable.app` returns the branded "This page didn't load" error page. Worker logs show, on every request:

```
Error: No such module "assets/rou3".
  imported from "assets/server-Bva90Nck.js"
GET https://assemble-joy-maker.lovable.app/ → 500
```

`rou3` (a TanStack Router transitive dep) is being externalized instead of bundled into the SSR Worker. The cause is in `src/server.ts`:

```ts
serverEntryPromise = import("@tanstack/react-start/server-entry").then(...)
```

The dynamic `import()` of the server entry inside a try/catch makes the bundler treat the chunk's deps as runtime-resolvable. Workers have no runtime module resolution, so `rou3` ends up missing from the bundle.

### 2. `theprimeroute.co.uk` returns 404

That domain currently doesn't resolve to Lovable at all — the response is a browser-level "page can't be found", not anything served by our worker. This is a DNS / domain-connection issue, not a code issue.

## Why the Cloudflare AI advice does NOT apply

The suggestion was to add `pages_build_output_dir` to `wrangler.jsonc`. That advice assumes you deploy this repo to **your own Cloudflare Pages project**. You don't — Lovable deploys `assemble-joy-maker.lovable.app` on its own infrastructure as a Cloudflare **Worker** (not Pages). The current `wrangler.jsonc` is correct:

```jsonc
{
  "name": "tanstack-start-app",
  "compatibility_date": "2025-09-24",
  "compatibility_flags": ["nodejs_compat"],
  "main": "src/server.ts"
}
```

Adding `pages_build_output_dir` would conflict with `main` and break the Workers build. Lovable's `@lovable.dev/vite-tanstack-config` already wires the Cloudflare Vite plugin. **No wrangler changes.**

## Fix

### Step 1 — Make the server entry import static (`src/server.ts`)

Replace the dynamic, lazily-resolved server-entry import with a static one, while keeping the try/catch + h3 500-normalization wrapper intact. Static import lets Vite/Rollup statically resolve and bundle `rou3` (and any other transitive router deps) into the Worker chunk.

```ts
import "./lib/error-capture";
import serverEntry from "@tanstack/react-start/server-entry";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// ...keep brandedErrorResponse and normalizeCatastrophicSsrResponse as-is...

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const response = await serverEntry.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
```

(Drop `getServerEntry`, `serverEntryPromise`, and the `ServerEntry` type — the static import covers both default and namespace export shapes in the current TanStack version.)

After the fix lands, click **Publish → Update** so the new SSR bundle replaces the broken one. I'll verify the published URL returns 200 instead of the branded error page.

### Step 2 — Fix `theprimeroute.co.uk` (DNS, no code)

This is a user-side task, not something I can change from the code:

1. Open **Project Settings → Project section → Domains** and confirm `theprimeroute.co.uk` is listed and its status (Verifying / Setting up / Active / Offline / Failed).
2. At your registrar, ensure DNS matches what Lovable shows there:
   - A record `@` → `185.158.133.1`
   - A record `www` → `185.158.133.1`
   - TXT `_lovable` → the verification value shown in the dialog
   - If you proxy through Cloudflare, re-add the domain with **Advanced → "Domain uses Cloudflare or a similar proxy"** checked (switches to CNAME verification).
3. Remove any stale A/AAAA/CNAME records pointing elsewhere.
4. Allow propagation (up to 72h, usually minutes).

Once Step 1 is deployed, both `assemble-joy-maker.lovable.app` and the custom domain (once DNS is right) will serve the app correctly via SSR.

## Files touched

- `src/server.ts` — only file edited.
- `wrangler.jsonc`, `vite.config.ts`, `package.json` — **not** touched.
