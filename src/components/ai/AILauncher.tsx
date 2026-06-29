import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The animated AI brand mark: a glossy door face that, while idle, does one full
 * 3D revolving-door spin every ~7s with a shimmer sweeping across it. Purely
 * presentational so it can live inside any button (launcher, chat header, etc.).
 * Respects prefers-reduced-motion (no spin/shimmer).
 */
export function AIDoorMark({
  accent = "#ef4444",
  sizeClass = "size-9",
  iconClass = "size-4",
  roundedClass = "rounded-full",
  open = false,
  idleSpin = true,
  className,
}: {
  accent?: string;
  sizeClass?: string;
  iconClass?: string;
  roundedClass?: string;
  open?: boolean;
  idleSpin?: boolean;
  className?: string;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!idleSpin || open) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const id = setInterval(() => {
      setActive(true);
      setTimeout(() => setActive(false), 1100);
    }, 4000);
    return () => clearInterval(id);
  }, [idleSpin, open]);

  return (
    <span
      className={cn("relative inline-grid place-items-center shrink-0", sizeClass, className)}
      style={{ perspective: "400px" }}
    >
      <span
        className={cn("relative grid h-full w-full place-items-center overflow-hidden text-white", roundedClass)}
        style={{
          background: `linear-gradient(145deg, ${hexToRgba(accent, 0.95)}, #020617)`,
          boxShadow: `0 0 0 1px ${hexToRgba(accent, 0.35)}, 0 8px 24px -8px ${hexToRgba(accent, 0.5)}`,
          animation: active ? "ai-door-spin 1.1s ease-in-out" : undefined,
          transformStyle: "preserve-3d",
        }}
      >
        {active && (
          <span
            className="absolute inset-0"
            style={{
              background: `linear-gradient(115deg, transparent 35%, ${hexToRgba("#ffffff", 0.4)} 50%, transparent 65%)`,
              backgroundSize: "250% 250%",
              animation: "ai-shimmer-once 1.1s ease-in-out",
            }}
          />
        )}
        <span className="relative z-10 grid place-items-center">
          {open ? <X className={iconClass} /> : <Sparkles className={iconClass} />}
        </span>
      </span>
    </span>
  );
}

/** The chat launcher button — the animated mark wrapped as a toggle. */
export function AILauncher({
  open,
  onToggle,
  accent = "#ef4444",
}: {
  open: boolean;
  onToggle: () => void;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="AI Assistant"
      className="shrink-0 rounded-full transition-transform hover:scale-105 active:scale-95"
    >
      <AIDoorMark
        accent={accent}
        open={open}
        sizeClass="size-7"
        iconClass="size-3.5"
        roundedClass="rounded-full"
      />
    </button>
  );
}
