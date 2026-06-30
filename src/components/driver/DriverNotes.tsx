import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import { addDriverRouteNote, listDriverRouteNotes } from "@/lib/notes.functions";
import { timeAgo } from "@/lib/time-ago";

type Note = {
  id: string;
  body: string;
  created_at: string;
  author_name: string | null;
  mine: boolean;
};

// Notes thread on a driver's route. Adding a note writes to the shared
// route_notes table, so the dispatcher sees it on the VRID; the driver also
// sees any note the dispatcher marked visible-to-drivers.
export function DriverNotes({ jobId }: { jobId: string }) {
  const list = useServerFn(listDriverRouteNotes);
  const add = useServerFn(addDriverRouteNote);
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    list({ data: { jobId } })
      .then((r) => setNotes(r as Note[]))
      .catch(() => {});
  }, [list, jobId]);
  useEffect(() => load(), [load]);

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      await add({ data: { jobId, body: text } });
      setBody("");
      toast.success("Note sent to dispatcher");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send note");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Notes</h2>
      </div>

      {notes.length > 0 && (
        <div className="space-y-2 mb-3">
          {notes.map((n) => (
            <div
              key={n.id}
              className={
                "rounded-lg border px-3 py-2 text-sm " +
                (n.mine
                  ? "border-primary/30 bg-primary/5"
                  : "border-amber-500/30 bg-amber-500/10")
              }
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {n.mine ? "You" : (n.author_name ?? "Dispatcher")}
                </span>
                <span className="font-mono">{timeAgo(n.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{n.body}</p>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note for the dispatcher…"
        rows={3}
        className="w-full bg-background border border-border rounded-lg p-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <button
        onClick={submit}
        disabled={busy || !body.trim()}
        className="mt-2 w-full bg-primary text-primary-foreground font-semibold text-sm py-2.5 rounded-lg active:scale-[0.99] transition disabled:opacity-40"
      >
        {busy ? "Sending…" : "Send note"}
      </button>
    </div>
  );
}
