## Problem
The preview is not failing because of backend env vars. It is still failing during SSR before the app can render.

I confirmed the active runtime error is still:
- `TypeError: toResponse is not a function`

And I isolated the mismatch to these files:
- `src/server.ts`
- `vite.config.ts`
- `wrangler.jsonc`
- `package.json`
- installed runtime package `node_modules/h3/package.json`
- installed framework code `node_modules/@tanstack/start-server-core/src/request-response.ts`

## What is actually wrong
`@tanstack/start-server-core` imports `toResponse` from `h3-v2`, which expects the H3 v2 API.
But the installed top-level `h3` package currently resolves to **v1.15.11**, which does not export `toResponse`.
That means the SSR worker is still bundling against the wrong H3 shape, so Cloudflare cannot render the site and returns a blank/failed preview.

## Plan
1. Remove the manual H3 override that forced an incompatible runtime shape.
   - Delete the direct `h3` dependency from `package.json`.
   - Keep the TanStack server entry wiring, but stop overriding TanStack’s H3 dependency graph.

2. Realign the framework package set.
   - Update the TanStack packages so `@tanstack/react-start`, `@tanstack/router-plugin`, and related runtime pieces resolve consistently.
   - Regenerate the lockfile so `h3-v2` resolves to the framework’s expected H3 v2 package instead of falling through to H3 v1.

3. Re-verify the SSR entry path only after dependency alignment.
   - Keep `src/server.ts` as the server entry wrapper if it is still needed for error capture.
   - Confirm `vite.config.ts` and `wrangler.jsonc` point at the correct server entry and are not reintroducing aliasing.

4. Validate the fix against the actual failure signal.
   - Check dev-server logs for the disappearance of `toResponse is not a function`.
   - Confirm preview SSR loads instead of returning the blank screen / Cloudflare error.
   - If preview is healthy but the public site still shows the old failure, note that the frontend publish must be updated.

## Technical details
- `node_modules/@tanstack/start-server-core/src/request-response.ts` imports:
  - `toResponse as h3_toResponse` from `h3-v2`
- `node_modules/h3/package.json` currently shows:
  - `version: 1.15.11`
- H3 v1 does not provide the export shape TanStack’s current server runtime expects.

## Expected outcome
After dependency alignment, SSR should stop crashing in the worker runtime, the preview should render normally again, and Cloudflare should no longer show the website error.