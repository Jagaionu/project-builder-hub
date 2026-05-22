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
    host.includes("lovableproject-dev.com");

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
    // Module is provided by vite-plugin-pwa virtual import; only exists in built bundle.
    const mod = (await import(/* @vite-ignore */ "virtual:pwa-register")) as {
      registerSW: (opts?: { immediate?: boolean }) => void;
    };
    mod.registerSW({ immediate: true });
  } catch {
    /* virtual module only exists in built bundles */
  }
}
