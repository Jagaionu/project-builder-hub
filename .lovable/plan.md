## Apply the two fixes

### 1. Replace `vite.config.ts`

Add the Cloudflare Vite plugin and nest plugins under `vite.plugins`:

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: { server: { entry: "server" } },
  vite: {
    plugins: [
      cloudflare(),
      VitePWA({ /* …existing PWA config unchanged… */ }),
    ],
  },
});
```

### 2. Pin TanStack versions in `package.json`

Align all three to `1.168.11`:
```
"@tanstack/react-router": "1.168.11",
"@tanstack/react-start":  "1.168.11",
"@tanstack/router-plugin": "1.168.11",
```
Then run `bun install` to refresh the lockfile.

### Notes

- `@cloudflare/vite-plugin` is already installed (verified in `node_modules`), no `bun add` needed.
- No app code, routes, server functions, or migrations are touched.

### Verify

- Dev server boots without `tanstackStart not defined`.
- `/`, `/login`, `/admin` on the published URL return real pages, not `Internal server error`.
