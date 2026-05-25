## Diagnosis

`src/integrations/supabase/client.server.ts` throws at first use if `SUPABASE_SERVICE_ROLE_KEY` is missing from `process.env`. Several code paths hit `supabaseAdmin` during SSR/loaders (e.g. `auth-helpers.server.ts`, `drivers-delete.functions.ts`, `pairing-login.ts`), so a missing key surfaces as a 500/SSR crash → Cloudflare 502.

Lovable Cloud's secret store shows `SUPABASE_SERVICE_ROLE_KEY` as present, but `.env` only has the publishable key. The Worker runtime gets env from the Cloud secret bindings, not `.env` — so the question is whether the key is actually bound to the deployed Worker.

## Plan

1. **Verify the key is reaching the Worker**
   - Call `stack_modern--server-function-logs` (published) and search for `Missing Supabase environment variable` / `SUPABASE_SERVICE_ROLE_KEY`.
   - Invoke a lightweight server fn (e.g. `/` SSR or `getDriversSnapshot`) via `stack_modern--invoke-server-function` and inspect logs.

2. **If the key is genuinely missing on the Worker**
   - Use `secrets--update_secret` for `SUPABASE_SERVICE_ROLE_KEY` so the user can paste it; this rebinds it to the Worker runtime.

3. **Harden against this class of failure** so a missing secret degrades gracefully instead of taking down SSR:
   - In `src/routes/_app.tsx` `beforeLoad`, the early super-admin / company-member checks already use the browser client (good). Confirm no public/SSR path needs `supabaseAdmin`.
   - In `auth-helpers.server.ts` and the other admin-touching server fns, keep using `supabaseAdmin`, but ensure they are only ever called from `createServerFn` handlers — never imported transitively into client/SSR root render.
   - Confirm `src/routes/__root.tsx` and `_app.tsx` don't transitively pull `client.server.ts` (per the import-graph rule). If they do, that's the real SSR crash trigger regardless of the key.

4. **Validate**
   - Re-invoke the home route and a protected server fn; check logs are clean and preview renders.
   - Tell the user to Publish so the live site picks up the fix.

No code changes proposed yet beyond (potentially) breaking a bad import chain in step 3 — first I need to confirm whether the secret is bound or whether an import graph is dragging `client.server.ts` into SSR.