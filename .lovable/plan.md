## Deployment failure root cause

Two issues hit this version. One is already fixed in the working tree; the other still needs a code change.

### Issue 1 — esbuild duplicate declarations (already fixed)
`src/lib/planner.ts` briefly contained two copies of the `schedDropMs` and `finalDwellMs` blocks. esbuild rejected it, no bundle was produced, and the preview returned 404. The current file only has one declaration (lines 597/603), so this no longer blocks builds. **No action needed** — just noting it so you know what caused the first red deploy.

### Issue 2 — Worker runtime can't find `h3-v2` (still broken)
The newer preview (`e3d6b1ed`) builds successfully but crashes on first request:
```
Error: No such module "h3-v2". imported from "server.js"
```
TanStack Start's SSR entry imports `h3-v2`, but Vite/Rollup left it as a runtime external. Cloudflare Workers cannot resolve runtime externals — every dep must be bundled into the worker chunk. The project already worked around the same class of issue for `rou3` in `src/server.ts` (the comment there explicitly says: "A static import so Vite/Rollup bundles all transitive deps … into the Worker chunk. A dynamic import() left them as runtime-resolved externals, which Workers cannot satisfy").

## Fix

Force `h3` / `h3-v2` to be bundled instead of externalized:

1. Confirm the version of `@tanstack/react-start` and which `h3` it pulls in (`h3-v2` is the v2 alias). Check `node_modules/@tanstack/react-start` and `bun.lockb`.
2. In `vite.config.ts`, add `h3` and `h3-v2` to `ssr.noExternal` (and `optimizeDeps.include` if needed) inside the `tanstackStart` plugin config, so Rollup inlines them into the worker bundle. Example shape:
   ```ts
   tanstackStart({
     server: {
       entry: "src/server.ts",
       noExternal: ["h3", "h3-v2"],
     },
   })
   ```
   (Exact key depends on the plugin's options surface — verify against installed `@tanstack/react-start` types before committing.)
3. If the plugin doesn't expose `noExternal`, the fallback is to add an explicit `ssr.noExternal: ["h3", "h3-v2"]` on the root Vite config — but only for the worker environment, never adding to `ssr.external` (per the project's server-runtime guard).
4. Rebuild locally and re-publish. Confirm preview SHA serves a 200 and no `No such module` error appears in worker logs.

## Out of scope
- No changes to the calendar / warehouse selector / driver edit dialog work — that code is fine. The deploy failure is unrelated to those features.

## Technical notes
- Diagnosis sources: dev-server log (duplicate-symbol esbuild errors at 08:45) and Cloudflare worker logs (`dwl.proxy.loader.error` at 09:10:31 with `error_message: No such module "h3-v2"`).
- Related guard already in repo: `src/server.ts` static import of `@tanstack/react-start/server-entry`, with the rou3 comment explaining the same constraint.
