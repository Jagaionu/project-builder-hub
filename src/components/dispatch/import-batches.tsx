import { useEffect, useState } from "react";
import { Clock, FileText, History, Trash2, Upload, X } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { importJobsCsv } from "@/lib/jobs-import.functions";
import { csvToImportRows } from "@/lib/csv-import";
import { reloadJobs } from "@/lib/hooks";
import { reloadJobStops } from "@/lib/dispatch/use-job-stops";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { deleteImportBatch } from "@/lib/delete-import-batch.functions";
import type { ImportBatchSummary } from "@/lib/jobs-import.functions";

function useImportBatches() {
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("import_batches" as never)
        .select(
          "id,file_name,row_count,created_count,parked_count,duplicate_count,error_count,created_at,expires_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (mounted && data) setBatches(data as unknown as ImportBatchSummary[]);
    };
    void load();
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void load(), 500);
    };
    const ch = supabase
      .channel(`rt-import-batches-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "import_batches" }, debounced)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return batches;
}

export function ImportToolsButton() {
  const [open, setOpen] = useState(false);
  const batches = useImportBatches();
  const runDelete = useServerFn(deleteImportBatch);
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
      await Promise.all([reloadJobs(), reloadJobStops()]);
      const parts: string[] = [res.created + " created"];
      if (res.parked.length) parts.push(res.parked.length + " parked (see Alerts)");
      if (res.skippedDuplicate.length) parts.push(res.skippedDuplicate.length + " duplicate");
      if (res.errors.length) parts.push(res.errors.length + " errors");
      toast.success(parts.join(" · "));
      if (res.skippedUnknownWh.length) {
        const codes = Array.from(new Set(res.skippedUnknownWh.flatMap((r) => r.missing)));
        toast.message("Parked — missing warehouse codes", {
          description: codes.join(", ") + ". Add them and these jobs will auto-release.",
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

  async function confirmDelete(b: ImportBatchSummary) {
    if (
      !confirm(
        `Delete import "${b.file_name}"?\n\nThis permanently removes all ${b.created_count} job(s) created from this file. This cannot be undone.`,
      )
    )
      return;
    try {
      const res = await runDelete({ data: { batchId: b.id } });
      toast.success(
        `Deleted ${(res as { deleted?: number }).deleted ?? b.created_count} job(s) from "${b.file_name}"`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
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
      <div className="relative inline-flex items-center h-8 rounded-full overflow-hidden border border-black/10 dark:border-white/10 shadow-[0_2px_6px_rgba(0,0,0,0.20)] bg-gradient-to-b from-[#f7f7f7] to-[#e6e6e6] dark:from-[#3d3d3d] dark:to-[#1e1e1e]">
        <span className="pointer-events-none absolute inset-x-1 top-px h-1/2 rounded-full bg-white/25" />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          data-ai-target="import-routes"
          className="relative inline-flex items-center gap-1.5 h-8 pl-1 pr-2.5 text-[11px] font-semibold text-neutral-800 dark:text-neutral-100 whitespace-nowrap hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="grid size-6 place-items-center rounded-full ring-1 ring-black/10 dark:ring-white/15 bg-gradient-to-b from-white to-[#d9d9d9] dark:from-[#2f2f2f] dark:to-black shadow-[inset_0_1px_2px_rgba(255,255,255,0.55),0_1px_2px_rgba(0,0,0,0.25)] [&_svg]:size-3">
            <Upload className="size-3" />
          </span>
          <span className="leading-none">{busy ? "Importing…" : "Import CSV"}</span>
        </button>
        <button
          onClick={() => setOpen(true)}
          title="History"
          aria-label="Import history"
          className="relative h-8 px-2.5 border-l border-black/15 dark:border-white/15 text-black/55 dark:text-white/70 transition-colors hover:text-black dark:hover:text-white hover:bg-black/10 dark:hover:bg-white/10"
        >
          <History className="size-3.5" />
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-2xl p-5 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold">Import History</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {batches.length} import{batches.length !== 1 ? "s" : ""} · batches expire after 14
              days
            </p>

            <div className="flex-1 overflow-y-auto space-y-2">
              {batches.length === 0 ? (
                <div className="rounded-xl border border-border bg-background px-4 py-10 text-center">
                  <Upload className="size-8 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No imports yet.</p>
                </div>
              ) : (
                batches.map((b) => {
                  const expires = new Date(b.expires_at);
                  const daysLeft = Math.max(
                    0,
                    Math.ceil((expires.getTime() - Date.now()) / 86_400_000),
                  );
                  const uploadedAt = new Date(b.created_at);
                  return (
                    <div
                      key={b.id}
                      className="rounded-xl border border-border bg-background px-4 py-3 flex items-center gap-3"
                    >
                      <div
                        className="size-9 rounded-lg grid place-items-center shrink-0"
                        style={{
                          background: "oklch(0.62 0.22 245 / 0.10)",
                          border: "1px solid oklch(0.62 0.22 245 / 0.20)",
                        }}
                      >
                        <FileText className="size-4" style={{ color: "var(--primary-bright)" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{b.file_name}</span>
                          <span className="text-[10px] font-mono text-muted-foreground/60">
                            {uploadedAt.toLocaleDateString([], {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}{" "}
                            {uploadedAt.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] font-mono">
                          <span style={{ color: "var(--success)" }}>
                            ✓ {b.created_count} created
                          </span>
                          {b.parked_count > 0 && (
                            <span style={{ color: "var(--warning-fg)" }}>
                              ⏸ {b.parked_count} parked
                            </span>
                          )}
                          {b.duplicate_count > 0 && (
                            <span className="text-muted-foreground">
                              ⟳ {b.duplicate_count} duplicate
                            </span>
                          )}
                          {b.error_count > 0 && (
                            <span style={{ color: "var(--destructive)" }}>
                              ✕ {b.error_count} errors
                            </span>
                          )}
                          <span
                            className="flex items-center gap-1 text-muted-foreground/60"
                            title={`Expires ${expires.toLocaleString()}`}
                          >
                            <Clock className="size-3" />
                            {daysLeft === 0 ? "expires today" : `${daysLeft}d left`}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => confirmDelete(b)}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/5 hover:bg-red-500/15 text-red-500 text-xs font-medium"
                        title={`Delete all ${b.created_count} jobs from this import`}
                      >
                        <Trash2 className="size-3.5" /> Delete all jobs
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
