import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider, useTheme, themeBootstrapScript } from "@/lib/theme-context";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const msg = error?.message ?? "";
  // A chunk / dynamic-import failure almost always means a new version was
  // deployed and the asset hashes changed under a stale service worker.
  const isChunkError =
    /dynamically imported module|module script failed|ChunkLoadError|Loading chunk|Failed to fetch|MIME type|Unexpected token/i.test(
      msg,
    );

  useEffect(() => {
    if (!isChunkError || typeof window === "undefined") return;
    const KEY = "tpr:self-healed";
    if (sessionStorage.getItem(KEY)) return; // already tried once this session
    sessionStorage.setItem(KEY, "1");
    // Self-heal: remove the stale service worker + caches, then reload once so
    // the freshly deployed assets are fetched from the network.
    void (async () => {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {
        /* ignore */
      } finally {
        window.location.reload();
      }
    })();
  }, [isChunkError]);

  if (isChunkError) {
    return (
      <div className="flex h-full min-h-[200px] w-full items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="size-4 rounded-full border-2 border-border border-t-primary animate-spin" />
          <span>Updating to the latest version…</span>
        </div>
      </div>
    );
  }

  // Any other error: surface it with manual recovery — never an infinite spinner.
  return (
    <div className="flex min-h-screen w-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
        <p className="mt-2 break-words text-sm text-muted-foreground">
          {msg || "An unexpected error occurred."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              router.invalidate();
            }}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "The Prime Route — UK Logistics Dispatch & Driver Tracking" },
      {
        name: "description",
        content:
          "The Prime Route is a UK logistics platform for Amazon warehouse operations: real-time driver tracking, dispatch planning, shift management, and route optimization.",
      },
      {
        name: "keywords",
        content:
          "UK logistics, dispatch software, Amazon logistics, driver tracking, route optimization, fleet management, shift planning",
      },
      { name: "author", content: "The Prime Route" },
      { name: "robots", content: "index, follow" },
      {
        property: "og:title",
        content: "The Prime Route — UK Logistics Dispatch & Driver Tracking",
      },
      {
        property: "og:description",
        content:
          "Real-time driver tracking, dispatch, and route optimization for UK Amazon warehouse logistics.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://theprimeroute.co.uk/" },
      { property: "og:site_name", content: "The Prime Route" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "The Prime Route — UK Logistics Dispatch" },
      {
        name: "twitter:description",
        content:
          "Real-time driver tracking, dispatch, and route optimization for UK Amazon warehouse logistics.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/532b9127-bc8f-4a7f-8298-e31a25825f17/id-preview-b66d18aa--de24c086-d49f-40b3-b183-98147b9f11b0.lovable.app-1779361381318.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/532b9127-bc8f-4a7f-8298-e31a25825f17/id-preview-b66d18aa--de24c086-d49f-40b3-b183-98147b9f11b0.lovable.app-1779361381318.png",
      },
    ],
    scripts: [{ children: themeBootstrapScript }],
    links: [
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon-96x96.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },

      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  // Driver-only Capacitor build loads the dispatcher index at "/"; send it to
  // the driver app. Gated by VITE_DRIVER_APP (set only in vite.config.driver.ts),
  // so the web/dispatcher SSR build is unaffected.
  useEffect(() => {
    if (
      (import.meta.env.VITE_DRIVER_APP as string | undefined) === "true" &&
      window.location.pathname === "/"
    ) {
      void router.navigate({ to: "/d", replace: true });
    }
  }, [router]);

  useEffect(() => {
    void import("@/lib/pwa").then((m) => m.registerPwa()).catch(() => {});
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <Outlet />
          <ThemedToaster />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} position="bottom-right" />;
}
