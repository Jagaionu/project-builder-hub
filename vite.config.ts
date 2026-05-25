import { defineConfig } from "@tanstack/react-start/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    server: {
      preset: "vercel",
      entry: "server",
    },
  },
  vite: {
    plugins: [
      tailwindcss(),
      tsConfigPaths(),
      VitePWA({
        registerType: "autoUpdate",
        devOptions: { enabled: false },
        injectRegister: false,
        includeAssets: ["favicon.ico", "icons/*.png"],
        manifest: {
          name: "Driver App",
          short_name: "Driver",
          description: "Route management for drivers",
          theme_color: "#0f172a",
          background_color: "#0f172a",
          display: "standalone",
          orientation: "portrait",
          scope: "/d/",
          start_url: "/d/",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html}"],
          navigateFallback: "/d/",
          navigateFallbackAllowlist: [/^\/d/],
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
  },
});
