import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { importJobsCsv } from "@/lib/jobs-import.functions";
import { csvToImportRows } from "@/lib/csv-import";

// ── ToolbarButton ───────────────────────────────────────────────────────────

export function ToolbarButton({
  onClick, disabled, icon, children, primary, title,
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
        "inline-flex items-center gap-1 rounded px-2 py-1.5 text-[11px] font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        primary
          ? "bg-primary text-primary-foreground shadow-sm hover:shadow-md"
          : "bg-surface border border-border text-foreground hover:bg-surface-2 shadow-sm",
      )}
    >
      {icon && <span className="size-3">{icon}</span>}
      {children}
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
      if (rows.length === 0) { toast.error("No rows found in CSV"); return; }
      const res = await runImport({ data: { rows } });
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
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      <ToolbarButton onClick={() => inputRef.current?.click()} disabled={busy} icon={<Upload className="size-3.5" />}>
        {busy ? "Importing…" : "Import CSV"}
      </ToolbarButton>
    </>
  );
}

// ── DispatchStat ────────────────────────────────────────────────────────────

export function DispatchStat({
  label, value, color, active, onClick,
}: {
  label: string; value: number; color: string; active?: boolean; onClick?: () => void;
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
        "border-t-[oklch(0.24_0.018_245)] border-r-[oklch(0.24_0.018_245)] border-b-[oklch(0.24_0.018_245)]",
        "data-[active=true]:border-t-[oklch(0.32_0.020_245)] data-[active=true]:border-r-[oklch(0.32_0.020_245)] data-[active=true]:border-b-[oklch(0.32_0.020_245)]",
        "bg-[oklch(0.17_0.018_245)] hover:bg-[oklch(0.19_0.018_245)]",
        "data-[active=true]:bg-[oklch(0.20_0.020_245)]",
        active ? "shadow-[0_2px_8px_oklch(0_0_0/0.25)]" : "shadow-none",
      )}
      style={{
        borderLeftColor: color,
        boxShadow: active ? `0 0 0 1px ${color}, 0 2px 8px oklch(0 0 0 / 0.25)` : undefined,
      }}
    >
      <div className="text-[9px] font-mono uppercase tracking-[0.08em] text-[oklch(0.55_0.014_245)] leading-none whitespace-nowrap">
        {label}
      </div>
      <div
        className="font-mono font-bold leading-none mt-1 text-[1.35rem] tabular-nums text-white"
      >
        {value}
      </div>
    </button>
  );
}
