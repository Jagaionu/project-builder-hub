import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { importJobsCsv } from "@/lib/jobs-import.functions";
import { csvToImportRows } from "@/lib/csv-import";

// ── ToolbarButton ────────────────────────────────────────────────────────────

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
        "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        primary
          ? "bg-gradient-to-b from-primary to-primary/85 text-primary-foreground shadow-[0_1px_0_oklch(1_0_0/0.18)_inset,0_4px_12px_oklch(0.62_0.22_245/0.35)] hover:shadow-[0_1px_0_oklch(1_0_0/0.2)_inset,0_6px_18px_oklch(0.62_0.22_245/0.5)] hover:-translate-y-px"
          : "bg-surface border border-border text-foreground hover:bg-surface-2 hover:border-border/70 shadow-sm",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ── ImportCsvButton ──────────────────────────────────────────────────────────

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
      const res = await runImport({ data: { rows } });
      const parts: string[] = [`${res.created} created`];
      if (res.skippedDuplicate.length) parts.push(`${res.skippedDuplicate.length} duplicate`);
      if (res.skippedUnknownWh.length) parts.push(`${res.skippedUnknownWh.length} unknown warehouse`);
      if (res.errors.length) parts.push(`${res.errors.length} errors`);
      toast.success(parts.join(" · "));
      if (res.skippedUnknownWh.length) {
        const codes = Array.from(new Set(res.skippedUnknownWh.flatMap((r) => r.missing)));
        toast.message("Missing warehouse codes", { description: codes.join(", ") });
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

// ── DispatchStat ─────────────────────────────────────────────────────────────

/**
 * Status counter card that doubles as a filter button.
 * Inline styles → Tailwind classes (no per-render JS object allocation, no
 * mouse-event style mutation that bypasses React).
 */
export function DispatchStat({
  label, value, color, active, onClick,
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
      style={{ borderLeftColor: color }}
      className={cn(
        "min-w-[76px] flex-shrink-0 px-3 py-1.5 text-left rounded-lg border-l-2 transition-all",
        "border-t border-r border-b",
        active
          ? "bg-[oklch(0.20_0.020_245)] border-[oklch(0.32_0.020_245)] shadow-[0_2px_8px_oklch(0_0_0/0.25)]"
          : "bg-[oklch(0.17_0.018_245)] border-[oklch(0.24_0.018_245)] hover:bg-[oklch(0.19_0.018_245)]",
      )}
    >
      <div className="text-[9px] font-mono uppercase tracking-[0.08em] text-muted-foreground leading-none whitespace-nowrap">
        {label}
      </div>
      <div
        className="text-[1.35rem] font-mono font-bold mt-0.5 leading-none tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
    </button>
  );
}
