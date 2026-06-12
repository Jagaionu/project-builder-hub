import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Cycle through on logo click (day mode only). Index 0 = default. */
export const BRAND_ACCENTS = ["#FFFFFF", "#E0FAFD", "#F4FAE4", "#FAEDE4", "#E5FAE4"] as const;
const ACCENT_STORAGE_KEY = "lov-accent";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  accentIndex: number;
  accentColor: string;
  cycleAccent: () => void;
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

function readAccentIndex(): number {
  if (typeof window === "undefined") return 0;
  const v = window.localStorage.getItem(ACCENT_STORAGE_KEY);
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < BRAND_ACCENTS.length ? n : 0;
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolved] = useState<ResolvedTheme>("dark");
  const [accentIndex, setAccentIndex] = useState(0);

  useEffect(() => {
    const stored = readStoredTheme();
    const resolved = stored === "system" ? getSystemTheme() : stored;
    setThemeState(stored);
    setResolved(resolved);
    applyTheme(resolved);
    setAccentIndex(readAccentIndex());
  }, []);

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

  const cycleAccent = () => {
    const next = (accentIndex + 1) % BRAND_ACCENTS.length;
    window.localStorage.setItem(ACCENT_STORAGE_KEY, String(next));
    setAccentIndex(next);
  };

  const accentColor = resolvedTheme === "dark" ? "" : BRAND_ACCENTS[accentIndex];

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, setTheme, accentIndex, accentColor, cycleAccent }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: "system",
      resolvedTheme: "dark",
      setTheme: () => {},
      accentIndex: 0,
      accentColor: "",
      cycleAccent: () => {},
    };
  }
  return ctx;
}

export const themeBootstrapScript = `
(function(){try{
  var k='${STORAGE_KEY}';
  var s=localStorage.getItem(k);
  var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  if(t==='dark')document.documentElement.classList.add('dark');
}catch(e){}})();
`;
