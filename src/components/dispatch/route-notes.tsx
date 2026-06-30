import { useCallback, useEffect, useState } from "react";
import { Trash2, X, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { useTenant } from "@/lib/tenant-context";
import { logActivity } from "@/lib/activity-log";
import { timeAgo } from "@/lib/time-ago";

type RouteNote = {
  id: string;
  body: string;
  created_at: string;
  author_name: string | null;
  author_email: string | null;
  author_avatar_url: string | null;
  visible_to_drivers: boolean | null;
};

// Notes attached to a route/VRID. Backed by public.route_notes. Notes flagged
// visible_to_drivers are shown to the assigned driver in the driver app (and a
// driver's own note is always visible_to_drivers). Typed via `as never` because
// route_notes isn't in the generated Database types.
export function RouteNotesButton({ jobId, reference }: { jobId: string; reference: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<RouteNote[]>([]);
  const [count, setCount] = useState(0);
  const [body, setBody] = useState("");
  const [adding, setAdding] = useState(false);
  const [visibleToDrivers, setVisibleToDrivers] = useState(false);
  const [busy, setBusy] = useState(false);
  const { userId, name, email, avatarUrl, company } = useTenant();
  const companyName = (company as { name?: string } | null)?.name ?? "your team";

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("route_notes" as never)
      .select(
        "id, body, created_at, author_name, author_email, author_avatar_url, visible_to_drivers",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as unknown as RouteNote[];
    setNotes(rows);
    setCount(rows.length);
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const tenant_id = await getTenantId();
      const { error } = await supabase.from("route_notes" as never).insert({
        job_id: jobId,
        body: text,
        tenant_id,
        author_user_id: userId,
        author_name: name ?? null,
        author_email: email,
        author_avatar_url: avatarUrl ?? null,
        visible_to_drivers: visibleToDrivers,
      } as never);
      if (error) throw error;
      void logActivity("note.add", { entityType: "job", entityId: jobId, entityRef: reference });
      setBody("");
      setAdding(false);
      setVisibleToDrivers(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add note");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const { error } = await supabase
      .from("route_notes" as never)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await load();
  }

  return (
    <>
      <button
        type="button"
        title={count > 0 ? count + " note" + (count === 1 ? "" : "s") : "Notes"}
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center justify-center size-8 rounded-md border border-border bg-surface hover:bg-surface-2 transition-colors"
      >
        <MessageSquare
          className={count > 0 ? "size-4 text-orange-500" : "size-4 text-muted-foreground"}
          fill={count > 0 ? "currentColor" : "none"}
        />
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 rounded-full bg-orange-500 text-white text-[10px] font-mono leading-none grid place-items-center">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-5 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">
                Notes for VRID <span className="font-mono">{reference}</span>
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Add note — collapsed row that expands on click */}
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full text-left rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground hover:border-primary/50 transition-colors"
              >
                Add note
              </button>
            ) : (
              <div className="rounded-lg border border-primary/50 bg-background p-2 focus-within:ring-1 focus-within:ring-ring">
                <textarea
                  autoFocus
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write a note…"
                  rows={3}
                  className="w-full resize-none bg-transparent px-1 py-0.5 text-sm focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={visibleToDrivers}
                      onChange={(e) => setVisibleToDrivers(e.target.checked)}
                      className="size-3.5 accent-amber-500"
                    />
                    Visible to {companyName} and any drivers
                  </label>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setAdding(false);
                        setBody("");
                        setVisibleToDrivers(false);
                      }}
                      className="rounded-md border border-border px-3 py-1 text-xs font-semibold hover:bg-surface-2"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={add}
                      disabled={busy || !body.trim()}
                      className="rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold disabled:opacity-50"
                    >
                      Add Note
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-3 flex-1 overflow-y-auto space-y-2 min-h-[60px]">
              {notes.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No notes yet.</p>
              ) : (
                notes.map((n) => {
                  const visible = !!n.visible_to_drivers;
                  return (
                    <div
                      key={n.id}
                      className={
                        "rounded-md border px-3 py-2 text-xs " +
                        (visible
                          ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                          : "border-border bg-background")
                      }
                    >
                      <div className="flex items-start gap-2">
                        {n.author_avatar_url ? (
                          <img
                            src={n.author_avatar_url}
                            alt=""
                            className="size-7 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="size-7 shrink-0 grid place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                            {(n.author_name ?? n.author_email ?? "?").charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">
                              <span className="font-semibold text-primary">
                                {n.author_name ?? n.author_email ?? "—"}
                              </span>
                              <span className="ml-1.5 text-muted-foreground">
                                · {timeAgo(n.created_at)}
                              </span>
                              {visible && (
                                <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                                  · Visible to drivers
                                </span>
                              )}
                            </span>
                            <button
                              onClick={() => remove(n.id)}
                              title="Delete note"
                              className="shrink-0 text-muted-foreground/60 hover:text-red-600"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-foreground">
                            {n.body}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-4 flex justify-end border-t border-border pt-3">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-4 py-1.5 text-xs font-semibold hover:bg-surface-2"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
