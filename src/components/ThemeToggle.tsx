import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";

// Glass-morphism light/dark toggle. Binary (no "system" option): clicking sets
// an explicit light or dark theme. Reflects the current resolved theme.
// Dark styles are keyed off the app's `.dark` class (on <html>) in styles.css.
export function ThemeToggle(_props: { compact?: boolean } = {}) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle light / dark theme"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn("tt-toggle", !isDark && "tt-active")}
    >
      <span className="tt-pico tt-moon left" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </span>
      <span className="tt-pico tt-sun right" aria-hidden="true">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
        </svg>
      </span>
      <span className="tt-ball" aria-hidden="true" />
      <span className="tt-glass" aria-hidden="true" />
      <span className={cn("tt-pring left", isDark && "glow")} aria-hidden="true" />
      <span className={cn("tt-pring right", !isDark && "glow")} aria-hidden="true" />
    </button>
  );
}
