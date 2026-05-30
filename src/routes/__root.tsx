import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
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
  const retriedRef = useRef(false);

  useEffect(() => {
    if (retriedRef.current) return;
    retriedRef.current = true;
    const t = setTimeout(() => {
      router.invalidate();
      reset();
    }, 50);
    return () => clearTimeout(t);
  }, [router, reset]);

  return (
    <div className="flex h-full min-h-[200px] w-full items-center justify-center p-6 animate-fade-in">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <div className="size-4 rounded-full border-2 border-border border-t-primary animate-spin" />
        <span>Loading…</span>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Planning System — UK Logistics Dispatch" },
      { name: "description", content: "Real-time driver tracking, dispatch, and route optimization for UK Amazon warehouse logistics." },
      { property: "og:title", content: "Planning System — UK Logistics Dispatch" },
      { property: "og:description", content: "Real-time driver tracking, dispatch, and route optimization for UK Amazon warehouse logistics." },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Planning System — UK Logistics Dispatch" },
      { name: "twitter:description", content: "Real-time driver tracking, dispatch, and route optimization for UK Amazon warehouse logistics." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/532b9127-bc8f-4a7f-8298-e31a25825f17/id-preview-b66d18aa--de24c086-d49f-40b3-b183-98147b9f11b0.lovable.app-1779361381318.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/532b9127-bc8f-4a7f-8298-e31a25825f17/id-preview-b66d18aa--de24c086-d49f-40b3-b183-98147b9f11b0.lovable.app-1779361381318.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    scripts: [
      { children: themeBootstrapScript },
    ],
    links: [
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
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

  useEffect(() => {
    void import("@/lib/pwa").then((m) => m.registerPwa());
  }, []);

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster theme="dark" position="bottom-right" />
      </QueryClientProvider>
    </AuthProvider>
  );
}
