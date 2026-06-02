import { useEffect, useState } from "react";
import { Clock, FileText, Trash2, Upload, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { deleteImportBatch } from "@/lib/delete-import-batch.functions";
import type { ImportBatchSummary } from "@/lib/jobs-import.functions";
import { ToolbarButton } from "./toolbar";

function useImportBatches() {
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("import_batches" as never)
        .select("id,file_name,row_count,created_count,parked_count,duplicate_count,error_count,created_at,expires_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (mounted && data) setBatches(data as unknown as ImportBatchSummary[]);
    };
    void load();
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => { if (t) clearTimeout(t); t = setTimeout(() => void load(), 500); };
    const ch = supabase
      .channel(`rt-import-batches-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "import_batches" }, debounced)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);
  return batches;
}

export function ImportBatchesButton() {
  const [open, setOpen] = useState(false);
  const batches = useImportBatches();
  const runDelete = useServerFn(deleteImportBatch);

  async function confirmDelete(b: ImportBatchSummary) {
    if (!confirm(`Delete import "${b.file_name}"?\n\nThis permanently removes all ${b.created_count} job(s) created from this file. This cannot be undone.`)) return;
    try {
      const res = await runDelete({ data: { batchId: b.id } });
      toast.success(`Deleted ${(res as { deleted?: number }).deleted ?? b.created_count} job(s) from "${b.file_name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <>
      <ToolbarButton onClick={() => setOpen(true)} icon={<Upload className="size-3.5" />}>
        Imports
      </ToolbarButton>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-2xl p-5 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold">Import Batches</h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {batches.length} import{batches.length !== 1 ? "s" : ""} · batches expire after 14 days
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
                  const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86_400_000));
                  const uploadedAt = new Date(b.created_at);
                  return (
                    <div key={b.id} className="rounded-xl border border-border bg-background px-4 py-3 flex items-center gap-3">
                      <div className="size-9 rounded-lg grid place-items-center shrink-0" style={{ background: "oklch(0.62 0.22 245 / 0.10)", border: "1px solid oklch(0.62 0.22 245 / 0.20)" }}>
                        <FileText className="size-4" style={{ color: "var(--primary-bright)" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{b.file_name}</span>
                          <span className="text-[10px] font-mono text-muted-foreground/60">
                            {uploadedAt.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}{" "}
                            {uploadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] font-mono">
                          <span style={{ color: "var(--success)" }}>✓ {b.created_count} created</span>
                          {b.parked_count > 0 && <span style={{ color: "var(--warning-fg)" }}>⏸ {b.parked_count} parked</span>}
                          {b.duplicate_count > 0 && <span className="text-muted-foreground">⟳ {b.duplicate_count} duplicate</span>}
                          {b.error_count > 0 && <span style={{ color: "var(--destructive)" }}>✕ {b.error_count} errors</span>}
                          <span className="flex items-center gap-1 text-muted-foreground/60" title={`Expires ${expires.toLocaleString()}`}>
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
