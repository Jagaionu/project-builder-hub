import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme-context";

const OPTIONS: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md p-0.5"
      style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}
    >
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setTheme(o.value)}
            title={o.label}
            aria-label={`Use ${o.label.toLowerCase()} theme`}
            aria-pressed={active}
            className="grid place-items-center rounded-sm transition-colors"
            style={{
              width: compact ? 22 : 24,
              height: compact ? 22 : 24,
              background: active ? "var(--color-surface)" : "transparent",
              color: active ? "var(--color-primary)" : "var(--color-muted-foreground)",
              boxShadow: active ? "var(--shadow-xs)" : "none",
            }}
          >
            <Icon className={compact ? "size-3" : "size-3.5"} />
          </button>
        );
      })}
    </div>
  );
}
