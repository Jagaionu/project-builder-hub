import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Stub virtual:pwa-register so the driver SPA has no service worker (we do not
// want SW caching inside the Capacitor shell). registerSW becomes a no-op.
function stubPwaRegister(): Plugin {
  const id = "virtual:pwa-register";
  const resolved = "\0" + id;
  return {
    name: "stub-pwa-register",
    resolveId(s) {
      if (s === id) return resolved;
    },
    load(s) {
      if (s === resolved) return "export function registerSW(){ return () => {}; }";
    },
  };
}

// Driver-only SPA build for the Capacitor native shell. Separate from the SSR
// vite.config.ts so the dispatcher Vercel deploy is unaffected.
export default defineConfig({
  plugins: [
    stubPwaRegister(),
    tanstackStart({
      server: { entry: "src/server.ts" },
      spa: { enabled: true, maskPath: "/d" },
    }),
    tailwindcss(),
    react(),
    tsconfigPaths(),
  ],
  resolve: { alias: { "@": "/src" } },
  define: { "import.meta.env.VITE_DRIVER_APP": JSON.stringify("true") },
  ssr: { noExternal: ["h3", "h3-v2"] },
});
