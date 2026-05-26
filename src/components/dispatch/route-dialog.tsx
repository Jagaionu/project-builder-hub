import { useState } from "react";
import { ChevronUp, ChevronDown, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { computeStopSchedule } from "@/lib/geo";
import type { Warehouse } from "@/lib/types";
import type { Stop } from "@/lib/dispatch/use-job-stops";

export interface RouteDialogProps {
  mode: "create" | "edit";
  jobId?: string;
  initial?: { scheduled_at: string | null; stops: Stop[] };
  onClose: () => void;
  warehouses: Warehouse[];
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RouteDialog({
  mode, jobId, initial, onClose, warehouses,
}: RouteDialogProps) {
  const [stops, setStops] = useState<Stop[]>(
    initial?.stops?.length
      ? initial.stops.map((s) => ({ ...s }))
      : [
          { kind: "PICKUP", warehouse_id: "", scheduled_at: new Date().toISOString() },
          { kind: "DROP", warehouse_id: "", scheduled_at: null },
        ],
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const startIso = stops[0]?.scheduled_at ?? initial?.scheduled_at ?? new Date().toISOString();
  const computedTimes = computeStopSchedule(stops, startIso, warehouses);

  function update(i: number, patch: Partial<Stop>) {
    setStops((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function move(i: number, dir: -1 | 1) {
    setStops((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }
  function addStop(kind: "PICKUP" | "DROP") {
    setStops((prev) => [...prev, { kind, warehouse_id: "", scheduled_at: null }]);
  }
  function removeStop(i: number) {
    setStops((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stops.length < 2) return toast.error("Need at least 2 stops");
    if (stops.some((s) => !s.warehouse_id)) return toast.error("Every stop needs a warehouse");
    setSaving(true);

    const jobStartIso = startIso;
    const autoTimes = computeStopSchedule(stops, jobStartIso, warehouses);
    const tenant_id = await getTenantId();
    const jobPayload = {
      scheduled_at: jobStartIso,
      origin_warehouse_id: stops[0].warehouse_id,
      destination_warehouse_id: stops[stops.length - 1].warehouse_id,
      tenant_id,
    };

    let targetJobId = jobId;
    if (mode === "create") {
      const { data, error } = await supabase
        .from("jobs")
        .insert(jobPayload as never)
        .select("id")
        .single();
      if (error) {
        setSaving(false);
        console.error("[jobs.insert]", error);
        return toast.error(`Job create failed: ${error.message}`);
      }
      targetJobId = (data as { id: string }).id;
    } else {
      const { error } = await supabase.from("jobs").update(jobPayload).eq("id", targetJobId!);
      if (error) {
        setSaving(false);
        console.error("[jobs.update]", error);
        return toast.error(`Job update failed: ${error.message}`);
      }
    }

    const { error: delErr } = await supabase
      .from("job_stops")
      .delete()
      .eq("job_id", targetJobId!);
    if (delErr) {
      setSaving(false);
      console.error("[stops.delete]", delErr);
      return toast.error(`Clear stops failed: ${delErr.message}`);
    }

    const rows = stops.map((s, i) => ({
      job_id: targetJobId!,
      seq: i,
      kind: s.kind as never,
      warehouse_id: s.warehouse_id,
      scheduled_at: i === 0 ? (s.scheduled_at ?? autoTimes[i] ?? null) : (autoTimes[i] ?? null),
    }));
    const { error: stopErr } = await supabase.from("job_stops").insert(rows as never);
    setSaving(false);
    if (stopErr) {
      console.error("[stops.insert]", stopErr, rows);
      return toast.error(`Stops insert failed: ${stopErr.message}`);
    }

    const firstArrival = rows.map((r) => r.scheduled_at).find((s) => !!s) as string | undefined;
    const firstDate = firstArrival ? firstArrival.slice(0, 10) : null;
    const tomorrow = (() => {
      const t = new Date();
      t.setUTCDate(t.getUTCDate() + 1);
      return t.toISOString().slice(0, 10);
    })();
    if (firstDate === tomorrow) {
      toast.success("Route scheduled for tomorrow — click Plan Tomorrow to assign a driver");
    } else {
      toast.success(mode === "create" ? "Route created" : "Route updated");
    }
    onClose();
  }

  async function onDelete() {
    if (!jobId) return;
    if (!confirm("Delete this lane? This cannot be undone.")) return;
    setDeleting(true);
    const { error } = await supabase.from("jobs").delete().eq("id", jobId);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success("Lane deleted");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-lg border border-border bg-surface shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">
            {mode === "create" ? "Create route" : "Edit route"}
          </h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Stops
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => addStop("PICKUP")} className="text-xs rounded border border-border px-2 py-1 hover:bg-surface-2">
                  + Pickup
                </button>
                <button type="button" onClick={() => addStop("DROP")} className="text-xs rounded border border-border px-2 py-1 hover:bg-surface-2">
                  + Drop
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {stops.map((s, i) => {
                const auto = computedTimes[i];
                return (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
                    <span className="font-mono text-xs text-muted-foreground w-6 text-right">{i + 1}.</span>
                    <select
                      value={s.kind}
                      onChange={(e) => update(i, { kind: e.target.value as "PICKU## Phase 2: UI Components

### 📄 `src/components/dispatch/toolbar.tsx`

```tsx
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { importJobsCsv } from "@/lib/jobs-import.functions";
import { csvToImportRows } from "@/lib/csv-import";

// ── Generic toolbar button ──────────────────────────────────────────────────

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
      type="button"
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

// ── CSV import button ───────────────────────────────────────────────────────

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

// ── Status box (filter chip) ────────────────────────────────────────────────

/**
 * Replaces 15+ inline-style props per render. CSS variable + utility classes
 * + a single `data-active` attribute means React only diffs the attribute.
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
      data-active={active ? "" : undefined}
      title={`Filter by ${label}`}
      style={{ "--accent": color } as React.CSSProperties}
      className={cn(
        "group/stat min-w-[76px] flex-shrink-0 cursor-pointer text-left transition-all duration-150",
        "rounded-lg px-3 py-[0.45rem] border-l-2 border-y border-r",
        "border-l-[var(--accent)] border-y-[oklch(0.24_0.018_245)] border-r-[oklch(0.24_0.018_245)]",
        "bg-[oklch(0.17_0.018_245)] hover:bg-[oklch(0.19_0.018_245)]",
        "data-[active]:bg-[oklch(0.20_0.020_245)]",
        "data-[active]:border-y-[oklch(0.32_0.020_245)] data-[active]:border-r-[oklch(0.32_0.020_245)]",
        "data-[active]:shadow-[0_0_0_1px_var(--accent),0_2px_8px_oklch(0_0_0/0.25)]",
      )}
    >
      <div className="text-[9px] font-mono uppercase tracking-[0.08em] text-muted-foreground leading-none whitespace-nowrap">
        {label}
      </div>
      <div
        className="mt-[0.2rem] font-mono text-[1.35rem] font-bold leading-none tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
    </button>
  );
}
