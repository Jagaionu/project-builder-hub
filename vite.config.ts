import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    tanstackStart({
      server: { entry: "src/server.ts" },
    }),
    tailwindcss(),
    react(),
    tsconfigPaths(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      injectRegister: false,
      includeAssets: ["favicon.ico", "icons/*.png", "site.webmanifest"],
      manifest: false,
      manifestFilename: "manifest.webmanifest",
      workbox: {
        globPatterns: ["**/*.{js,css,html}"],
        navigateFallback: "/d",
        navigateFallbackAllowlist: [/^\/d(\/|$)/],
        navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\//,
            handler: "NetworkFirst",
            options: { cacheName: "supabase-api", networkTimeoutSeconds: 5 },
          },
          {
            urlPattern: ({ request }: { request: Request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: { cacheName: "html", networkTimeoutSeconds: 3 },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  ssr: {
    // Force h3 / h3-v2 into the worker bundle. They are pulled in by
    // @tanstack/start-server-core's SSR entry; if left as runtime externals
    // the Cloudflare Worker fails with `No such module "h3-v2"` on first
    // request (workerd can't resolve npm specifiers at runtime).
    noExternal: ["h3", "h3-v2"],
  },
});
