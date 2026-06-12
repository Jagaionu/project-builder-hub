import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { importJobsCsv } from "@/lib/jobs-import.functions";
import { csvToImportRows } from "@/lib/csv-import";
import { reloadJobs } from "@/lib/hooks";
import { reloadJobStops } from "@/lib/dispatch/use-job-stops";

// ── ToolbarButton ───────────────────────────────────────────────────────────

export function ToolbarButton({
  onClick,
  disabled,
  icon,
  children,
  primary,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium tracking-tight",
        "transition-all duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        "active:scale-[0.98]",
        primary
          ? [
              "bg-primary text-primary-foreground",
              "shadow-[0_1px_0_0_color-mix(in_oklab,white_15%,transparent)_inset,0_1px_2px_0_color-mix(in_oklab,black_30%,transparent)]",
              "hover:bg-[color:color-mix(in_oklab,var(--color-primary)_92%,white)]",
            ].join(" ")
          : [
              "bg-surface text-foreground border border-border",
              "shadow-[0_1px_0_0_color-mix(in_oklab,white_4%,transparent)_inset,0_1px_2px_0_color-mix(in_oklab,black_20%,transparent)]",
              "hover:bg-surface-2 hover:border-[color:var(--border-strong)] hover:text-foreground",
            ].join(" "),
      )}
    >
      {icon && (
        <span
          className={cn(
            "inline-flex items-center justify-center [&_svg]:size-3.5",
            primary ? "opacity-90" : "text-muted-foreground",
          )}
        >
          {icon}
        </span>
      )}
      <span className="leading-none">{children}</span>
    </button>
  );
}

// ── ImportCsvButton ─────────────────────────────────────────────────────────

export function ImportCsvButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const runImport = useServerFn(importJobsCsv);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const rows = csvToImportRows(text);
      if (rows.length === 0) {
        toast.error("No rows found in CSV");
        return;
      }
      const res = await runImport({ data: { rows, fileName: file.name } });
      // Import writes server-side via supabaseAdmin; refetch so the new routes
      // appear immediately instead of waiting on a realtime echo / manual reload.
      await Promise.all([reloadJobs(), reloadJobStops()]);
      const parts: string[] = [`${res.created} created`];
      if (res.parked.length) parts.push(`${res.parked.length} parked (see Alerts)`);
      if (res.skippedDuplicate.length) parts.push(`${res.skippedDuplicate.length} duplicate`);
      if (res.errors.length) parts.push(`${res.errors.length} errors`);
      toast.success(parts.join(" · "));
      if (res.skippedUnknownWh.length) {
        const codes = Array.from(new Set(res.skippedUnknownWh.flatMap((r) => r.missing)));
        toast.message("Parked — missing warehouse codes", {
          description: `${codes.join(", ")}. Add them and these jobs will auto-release.`,
        });
      }
      if (res.errors.length) console.error("[csv-import] errors", res.errors);
    } catch (err) {
      console.error("[csv-import]", err);
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onFile}
      />
      <ToolbarButton
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        icon={<Upload className="size-3.5" />}
      >
        {busy ? "Importing…" : "Import CSV"}
      </ToolbarButton>
    </>
  );
}

// ── DispatchStat ────────────────────────────────────────────────────────────

export function DispatchStat({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Filter by ${label}`}
      data-active={active ? "true" : "false"}
      className={cn(
        "min-w-[76px] flex-shrink-0 rounded-lg border-l-2 px-3 py-1.5 text-left transition-all cursor-pointer",
        "border-t border-r border-b",
        "border-t-border border-r-border border-b-border",
        "data-[active=true]:border-t-[color:var(--border-strong)] data-[active=true]:border-r-[color:var(--border-strong)] data-[active=true]:border-b-[color:var(--border-strong)]",
        "bg-surface hover:bg-surface-2",
        "data-[active=true]:bg-input",
        active ? "shadow-md" : "shadow-none",
      )}
      style={{
        borderLeftColor: color,
        boxShadow: active ? `0 0 0 1px ${color}, 0 2px 8px oklch(0 0 0 / 0.25)` : undefined,
      }}
    >
      <div className="text-[9px] font-mono uppercase tracking-[0.08em] text-muted-foreground leading-none whitespace-nowrap">
        {label}
      </div>
      <div className="font-mono font-bold leading-none mt-1 text-[1.35rem] tabular-nums text-foreground">
        {value}
      </div>
    </button>
  );
}

// ── AutoRefreshButton ─────────────────────────────────────────────────────────
// Minimal icon-only dropdown to auto re-fetch dispatch data on an interval.

const REFRESH_OPTIONS = [1, 2, 5, 10];

export function AutoRefreshButton() {
  const [minutes, setMinutes] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const n = Number(localStorage.getItem("dispatch.autoRefreshMin"));
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    try {
      if (minutes && minutes > 0) localStorage.setItem("dispatch.autoRefreshMin", String(minutes));
      else localStorage.removeItem("dispatch.autoRefreshMin");
    } catch {
      /* noop */
    }
    if (!minutes || minutes <= 0) return;
    const id = setInterval(() => window.location.reload(), minutes * 60_000);
    return () => clearInterval(id);
  }, [minutes]);

  const pick = (m: number | null) => {
    setMinutes(m);
    setCustom("");
    setOpen(false);
  };
  const itemCls = (a: boolean) =>
    cn(
      "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-surface-2",
      a ? "text-primary font-semibold" : "text-foreground",
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Auto-refresh"
          title={minutes ? `Auto-refresh whole page every ${minutes} min` : "Auto-refresh off"}
          className="grid place-items-center rounded-md transition-colors"
          style={{
            width: 24,
            height: 24,
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            color: minutes ? "var(--color-primary)" : "var(--color-muted-foreground)",
          }}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-40 p-1">
        <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Auto-refresh
        </div>
        <button onClick={() => pick(null)} className={itemCls(minutes === null)}>
          Off
        </button>
        {REFRESH_OPTIONS.map((m) => (
          <button key={m} onClick={() => pick(m)} className={itemCls(minutes === m)}>
            {m} min
          </button>
        ))}
        <div className="flex items-center gap-1 px-2 py-1.5">
          <input
            type="number"
            min={1}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="min"
            className="w-14 h-7 px-2 rounded border border-border bg-surface text-xs"
          />
          <button
            onClick={() => {
              const n = Number(custom);
              if (Number.isFinite(n) && n > 0) pick(n);
            }}
            className="h-7 px-2 rounded bg-primary text-primary-foreground text-xs"
          >
            Set
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
