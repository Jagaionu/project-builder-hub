# Add Light Mode Across the App

The app currently has only a dark theme: `:root` in `src/styles.css` holds the dark tokens, and many components hardcode `oklch(...)` values inline that match those dark tokens. The driver PWA layout even force-applies `className="dark"`. Adding a working light mode requires three things: a real token split, a theme toggle wired everywhere, and a sweep of every hardcoded color so both themes look intentional.

## 1. Restructure color tokens

In `src/styles.css`:

- Move the current dark palette (lines ~68–131) into a `.dark { ... }` selector.
- Replace `:root { ... }` with a true **light** palette covering every token currently defined: `--background`, `--surface`, `--surface-2`, `--surface-3`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--success`, `--warning`, `--info`, `--border`, `--input`, `--ring`, all `--shift-*` tokens.
- Add the missing shadow + glow tokens for light (the existing shadow scale uses `oklch(0 0 0 / 0.25..0.45)` — keep but lower opacity in light to avoid heavy bands).
- Add `.dark { color-scheme: dark; }` (exists) and `:root { color-scheme: light; }`.
- Light palette direction: near-white background (`oklch(0.99 0.003 245)`), subtle blue-tinted surface layers, dark slate text, same electric blue primary at slightly higher chroma so it still pops on light, semantic colors retuned for AA contrast on white.

## 2. Refactor hardcoded inline colors

Several components inline `style={{ background: "oklch(0.15 ...)" }}` literals that only work on dark. These have to become token references (`var(--surface)`, `var(--border)`, etc.) or Tailwind classes (`bg-surface`, `border-border`) so they flip with the theme.

Files to sweep (counts of `oklch(` literals):

- `src/components/Sidebar.tsx` (32) — brand header, nav-item active strip, badges, footer user row, divider, all need tokenization.
- `src/components/StatusBadge.tsx` (42) — status color map; expose as semantic tokens (`--status-available`, `--status-delayed`, …) or split into per-theme values via `.dark` overrides.
- `src/components/driver/DriverJobCard.tsx` (29), `DriverBottomNav.tsx` (5).
- `src/components/dispatch/queue.tsx`, `toolbar.tsx`, `drivers/driver-queue.tsx`, `drivers/driver-detail-panel.tsx`.
- `src/routes/_app.events.tsx`, `_app.alerts.tsx`, `_app.index.tsx`, `_app.drivers.tsx`, `_app.dispatch.tsx`, `login.tsx`, `d.index.tsx`, `d.profile.tsx`.
- `src/lib/dispatch/status.ts` — status → color map; convert to token names.
- Tailwind classes to fix: `bg-white`, `text-white`, `bg-black` in `LiveMap.tsx`, `PwaInstallPrompt.tsx`, `_app.drivers.tsx`, `dispatch/toolbar.tsx` → use semantic equivalents.

Strategy per element:

- If the literal matches an existing token (e.g. `oklch(0.17 0.018 245)` ↔ `--surface`), replace with `var(--surface)` / `bg-surface`.
- If it's a one-off tint (e.g. `oklch(0.62 0.22 245 / 0.12)` for "active nav"), introduce a named token like `--primary-soft` so both themes get a tasteful tint.
- Keep all "color/glow" tokens semantic (`--shadow-glow-primary`) and define separate values under `.dark`.

## 3. Theme provider + toggle

New file `src/lib/theme-context.tsx`:

- `ThemeProvider` reading `localStorage.theme` (`"light" | "dark" | "system"`, default `"system"`).
- Effect that toggles `document.documentElement.classList` (`dark`) and updates on `prefers-color-scheme` change when `"system"`.
- Inline pre-hydration script in `src/routes/__root.tsx` `head.scripts` (or a small `<script>` injected in `RootShell`) to set the class **before** first paint — avoids the flash of dark on a light-preferring user.
- `useTheme()` hook returns `{ theme, resolvedTheme, setTheme }`.

Wire-up:

- Wrap `<AuthProvider>` in `RootComponent` with `<ThemeProvider>`.
- New `src/components/ThemeToggle.tsx` (Sun/Moon/Monitor icons from lucide) shown in:
  - Dispatch app: `Sidebar.tsx` footer next to the user row.
  - Driver PWA: small icon-only button in `d.profile.tsx` settings list.
- Update Sonner: `<Toaster theme={resolvedTheme} ... />` instead of hardcoded `"dark"`.

## 4. Driver PWA scoping

`src/routes/d.tsx` currently does `className="min-h-screen bg-background dark driver-app"`. Remove the literal `dark` so the driver app follows the chosen theme. Then re-test all driver screens (`d.index`, `d.profile`, `d.report`, `d.routes.$jobId`, `d.login`) and any inline-styled card.

`DriverBottomNav` CSS in `styles.css` uses `oklch(0.15 0.018 245 / 0.92)` — replace with `color-mix(in oklab, var(--background) 92%, transparent)` so it works on both themes.

## 5. Map (Leaflet) handling

`src/styles.css` applies `filter: invert(100%) hue-rotate(180deg) ...` to the tile pane globally — this assumes a dark theme map.

- Scope it: `.dark .leaflet-tile-pane { filter: ... }` only.
- In light mode, let the default OSM tiles render naturally; restyle popups, controls, and zoom buttons via tokens.
- `LiveMap.tsx` has 39 hardcoded color classes — audit its overlays/legends and convert.

## 6. Polish + audit

- Glass card, status dots, badges, scrollbar thumb, sidebar brand gradient, page-transition shadows — re-derive each from tokens so light mode gets a soft "frosted white on warm background" feel, not a literal palette inversion.
- Table headers in `.table-container thead th` use `oklch(0.15 0.018 245 / 0.95)` — make it `var(--surface)` with backdrop-blur.
- Toast border tints (success/error/warning) already use semantic-ish oklch — fine, just verify contrast.
- Focus rings already use `var(--color-primary)` — works in both themes.

## 7. QA pass

For every route under `/_app/*`, `/d/*`, `/login`, `/admin`, `/suspended`:

- Switch theme, eyeball each page, check: text legibility, border visibility, hover states, badges, charts (if any), modals/popovers, sidebar selected state, driver bottom nav, map overlays, login screen, error/empty states.
- Use the browser preview at 411x776 (driver) and a wide viewport (dispatch).
- Fix per-component contrast issues until both themes are clean.

## Technical notes

- Default theme = `"system"`. No DB or schema changes.
- All tokens stay in `oklch()` for perceptual uniformity.
- Tailwind v4 with `@custom-variant dark (&:is(.dark *))` is already set up, so `dark:bg-...` utilities work; we'll prefer semantic tokens (`bg-surface`) over `dark:` variants to keep components theme-agnostic.
- No new dependencies — icons come from `lucide-react` already in use.

## Out of scope

- Per-user theme persistence in the database (localStorage only).
- Reskinning charts/icons beyond color tokens.
- Changing brand identity, fonts, or layout.
