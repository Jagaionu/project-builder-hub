## Goal
Make the app open reliably in the browser preview and remove the broken/incorrect login experience that appears instead of the app.

## Plan
1. Inspect the root app shell and login route integration to fix the route/render mismatch causing the preview to fail or show the wrong login surface.
2. Repair the root shell so TanStack Router head/render APIs are used in a safe place and do not trigger the `useContext` / invalid hook error seen in the preview.
3. Remove the SSR/client mismatch on the custom `/login` route so preview no longer falls back to stale or conflicting HTML.
4. Verify the preview on mobile-sized viewport and confirm the app opens instead of showing an internal server error or the external Lovable login screen.

## What I found
- The hosted backend looks healthy, so this is not a backend outage.
- The sandbox app can render the custom `/login` page, but the failing preview/browser experience is inconsistent with that.
- Runtime evidence points to a client/render crash around `HeadContent` with `Cannot read properties of null (reading 'useContext')`.
- There is also a hydration mismatch on `/login`, which can make preview behavior unstable.
- The public preview URL currently shows the platform login surface instead of your in-app login page, so the app shell/auth flow is not behaving consistently across environments.

## Technical details
- Investigate and adjust:
  - `src/routes/__root.tsx`
  - `src/router.tsx`
  - `src/routes/login.tsx`
- Focus on:
  - root shell/head rendering placement
  - eliminating the invalid hook/useRouter context error
  - removing nondeterministic client-only rendering on login
  - preserving your existing dispatch logic without changing business rules

## Verification
- Open `/login` and `/` in preview
- Confirm no runtime `useContext` crash
- Confirm no hydration mismatch on login
- Confirm browser preview opens the app instead of showing an internal server error screen