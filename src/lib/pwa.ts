// Registers the PWA service worker only on a real published deploy.
// In Lovable's editor preview (iframe + preview hostnames) we unregister any
// existing SW and skip registration to avoid stale-content / nav issues.
export async function registerPwa() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("preview--") ||
    host.includes("lovableproject.com") ||
    host.includes("lovableproject-dev.com") ||
    (host.includes("vercel.app") && host.includes("-preview"));

  if (isInIframe || isPreviewHost) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {
      /* noop */
    }
    return;
  }

  try {
    // Real virtual module from vite-plugin-pwa. A literal dynamic import lets
    // the plugin transform it at build time (the previous new Function() hack
    // hid it from the plugin, so it shipped unresolved and CORS-failed at
    // runtime, which broke SW auto-update).
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
  } catch {
    /* virtual module only exists in built bundles */
  }
}
