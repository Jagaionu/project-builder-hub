import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "lov-theme";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR-safe: default to "system" / "dark" on the server, hydrate on mount.
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolved] = useState<ResolvedTheme>("dark");

  // Initial hydration
  useEffect(() => {
    const stored = readStoredTheme();
    const resolved = stored === "system" ? getSystemTheme() : stored;
    setThemeState(stored);
    setResolved(resolved);
    applyTheme(resolved);
  }, []);

  // Watch system changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const next: ResolvedTheme = e.matches ? "dark" : "light";
      setResolved(next);
      applyTheme(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    window.localStorage.setItem(STORAGE_KEY, t);
    const resolved = t === "system" ? getSystemTheme() : t;
    setThemeState(t);
    setResolved(resolved);
    applyTheme(resolved);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback for components rendered outside provider (e.g. SSR shell).
    return {
      theme: "system",
      resolvedTheme: "dark",
      setTheme: () => {},
    };
  }
  return ctx;
}

/** Inline pre-hydration script — set the .dark class before first paint. */
export const themeBootstrapScript = `
(function(){try{
  var k='${STORAGE_KEY}';
  var s=localStorage.getItem(k);
  var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  if(t==='dark')document.documentElement.classList.add('dark');
}catch(e){}})();
`;
