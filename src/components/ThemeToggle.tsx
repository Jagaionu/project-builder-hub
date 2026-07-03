import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";

// Sun rays (x1,y1,x2,y2) in the 26x26 icon viewBox.
const SUN_RAYS: ReadonlyArray<readonly [number, number, number, number]> = [
  [13, 6.7, 13, 2.4],
  [15.4, 7.2, 17.1, 3.2],
  [17.5, 8.5, 20.5, 5.5],
  [18.8, 10.6, 22.8, 8.9],
  [19.3, 13, 23.6, 13],
  [18.8, 15.4, 22.8, 17.1],
  [17.5, 17.5, 20.5, 20.5],
  [15.4, 18.8, 17.1, 22.8],
  [13, 19.3, 13, 23.6],
  [10.6, 18.8, 8.9, 22.8],
  [8.5, 17.5, 5.5, 20.5],
  [7.2, 15.4, 3.2, 17.1],
  [6.7, 13, 2.4, 13],
  [7.2, 10.6, 3.2, 8.9],
  [8.5, 8.5, 5.5, 5.5],
  [10.6, 7.2, 8.9, 3.2],
];

// Glass-morphism light/dark toggle. The knob "rolls" between the two ends with a
// squash/stretch while the icon on it morphs from a crescent moon (dark) to a
// rayed sun (light), with a soft shadow blob passing underneath. Binary theme
// (no system option). Dark styles key off the app's `.dark` class in styles.css.
export function ThemeToggle(_props: { compact?: boolean } = {}) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Unique gradient/mask ids so multiple instances never clash.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const moonId = `ttMoon${uid}`;
  const sunId = `ttSun${uid}`;
  const cresId = `ttCres${uid}`;

  // Animate only on user-driven changes, not the initial mount.
  const firstRender = useRef(true);
  const [anim, setAnim] = useState<null | "right" | "left">(null);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setAnim(isDark ? "left" : "right");
  }, [isDark]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle light / dark theme"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="tt-toggle"
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

      <span
        className={cn(
          "tt-ball",
          anim === "right" && "anim-right",
          anim === "left" && "anim-left",
          !anim && !isDark && "at-right sun-state",
        )}
        onAnimationEnd={(e) => {
          // Only reset when the ball's own roll finishes. Child animations
          // (morph/shadow) end sooner and their animationend bubbles up here —
          // resetting on those would cut the roll and shadow pulse short.
          if (e.target === e.currentTarget) setAnim(null);
        }}
        aria-hidden="true"
      >
        <span className="tt-ball-shadow" />
        <svg className="tt-bsvg" viewBox="0 0 26 26" fill="none">
          <defs>
            <linearGradient id={moonId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#F2F6FF" />
              <stop offset="100%" stopColor="#AEBEE8" />
            </linearGradient>
            <radialGradient id={sunId} cx="35%" cy="32%" r="75%">
              <stop offset="0%" stopColor="#FFD75E" />
              <stop offset="100%" stopColor="#F97316" />
            </radialGradient>
            <mask id={cresId}>
              <circle cx="13" cy="13" r="8" fill="white" />
              <circle cx="16.4" cy="10.2" r="7" fill="black" />
            </mask>
          </defs>
          <g className="tt-gmoon">
            <circle cx="13" cy="13" r="8" fill={`url(#${moonId})`} mask={`url(#${cresId})`} />
          </g>
          <g className="tt-gsun">
            <circle cx="13" cy="13" r="5.2" fill={`url(#${sunId})`} />
            {SUN_RAYS.map((r, i) => (
              <line
                key={i}
                className="tt-ray"
                x1={r[0]}
                y1={r[1]}
                x2={r[2]}
                y2={r[3]}
                stroke={`url(#${sunId})`}
              />
            ))}
          </g>
        </svg>
      </span>

      <span className="tt-glass" aria-hidden="true" />
      <span className={cn("tt-pring left", isDark && "glow")} aria-hidden="true" />
      <span className={cn("tt-pring right", !isDark && "glow")} aria-hidden="true" />
    </button>
  );
}
