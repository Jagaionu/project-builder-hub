import { useCallback, useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";

type RouteNote = { id: string; body: string; created_at: string };

// Notes attached to a route/VRID. Backed by public.route_notes (see SQL in the
// handoff); rows cascade-delete when the job is deleted. Typed via `as never`
// because route_notes isn't in the generated Database types.
export function RouteNotesButton({ jobId, reference }: { jobId: string; reference: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<RouteNote[]>([]);
  const [count, setCount] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("route_notes" as never)
      .select("id, body, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as unknown as RouteNote[];
    setNotes(rows);
    setCount(rows.length);
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const tenant_id = await getTenantId();
      const { error } = await supabase
        .from("route_notes" as never)
        .insert({ job_id: jobId, body: text, tenant_id } as never);
      if (error) throw error;
      setBody("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add note");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("route_notes" as never).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await load();
  }

  return (
    <>
      <button
        type="button"
        title="Notes"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 hover:bg-amber-500/15"
      >
        <span className="text-sm leading-none">📑</span> Notes
        {count > 0 ? <span className="ml-0.5 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-amber-500/20 text-amber-600 text-[10px] font-mono leading-none">{count}</span> : null}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-5 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-0.5">
              <h3 className="text-sm font-semibold">Notes</h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground mb-3">{reference}</p>

            <div className="flex-1 overflow-y-auto space-y-2 mb-3 min-h-[60px]">
              {notes.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No notes yet.</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex-1 whitespace-pre-wrap break-words">{n.body}</p>
                      <button onClick={() => remove(n.id)} title="Delete note" className="shrink-0 text-muted-foreground hover:text-red-500">
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                      {new Date(n.created_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-end gap-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Add a note…"
                rows={2}
                className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={add}
                disabled={busy || !body.trim()}
                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
