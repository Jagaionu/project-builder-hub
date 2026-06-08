import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/lib/tenant-context";
import { toast } from "sonner";
import { ArrowLeft, Send } from "lucide-react";

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

type Ticket = { id: string; ref: string | null; title: string; category: string; severity: number; status: string; created_at: string; created_by_name: string | null; description: string };
type Msg = { id: string; author_name: string | null; is_admin: boolean; is_system: boolean; body: string; created_at: string };
const SEV: Record<number, string> = { 1: "Critical", 2: "High", 3: "Medium", 4: "Low", 5: "Trivial" };
const STATUS: Record<string, { label: string; bg: string }> = {
  pending: { label: "Pending", bg: "var(--destructive)" },
  in_progress: { label: "In progress", bg: "var(--warning)" },
  resolved: { label: "Resolved", bg: "var(--success)" },
};
function when(iso: string): string { return new Date(iso).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }

export function SupportTicketThread({ ticketId, isAdmin, onBack }: { ticketId: string; isAdmin: boolean; onBack?: () => void }) {
  const { name, userId } = useTenant();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadTicket = useCallback(async () => {
    const { data } = await sb.from("support_tickets").select("id,ref,title,category,severity,status,created_at,created_by_name,description").eq("id", ticketId).maybeSingle();
    setTicket(data as Ticket | null);
  }, [ticketId]);
  const loadMsgs = useCallback(async () => {
    const { data } = await sb.from("support_ticket_messages").select("id,author_name,is_admin,is_system,body,created_at").eq("ticket_id", ticketId).order("created_at", { ascending: true });
    setMsgs((data ?? []) as Msg[]);
  }, [ticketId]);
  useEffect(() => { void loadTicket(); void loadMsgs(); }, [loadTicket, loadMsgs]);
  useEffect(() => {
    const ch = supabase.channel("rt-ticket-" + ticketId)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_ticket_messages", filter: `ticket_id=eq.${ticketId}` }, () => void loadMsgs())
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets", filter: `id=eq.${ticketId}` }, () => void loadTicket())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ticketId, loadMsgs, loadTicket]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const post = async (text: string, system = false) => {
    const t = text.trim(); if (!t) return;
    await sb.from("support_ticket_messages").insert({
      ticket_id: ticketId, author_id: userId ?? null,
      author_name: name ?? (isAdmin ? "Support" : "Reporter"),
      is_admin: isAdmin, is_system: system, body: t,
    });
  };
  const send = async () => {
    if (!body.trim()) return; setBusy(true);
    try { await post(body); setBody(""); await loadMsgs(); }
    catch { toast.error("Could not send"); } finally { setBusy(false); }
  };
  const setStatus = async (status: string, sysMsg: string) => {
    const { error } = await sb.from("support_tickets").update({ status }).eq("id", ticketId);
    if (error) { toast.error("Could not update status"); return; }
    await post(sysMsg, true); await loadTicket(); await loadMsgs();
  };
  const reopen = async () => {
    const { error } = await sb.rpc("reopen_support_ticket", { p_ticket_id: ticketId });
    if (error) { toast.error("Could not re-open"); return; }
    await post("Re-opened by the reporter - the issue is not resolved.", true); await loadTicket(); await loadMsgs();
  };

  if (!ticket) return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  const st = STATUS[ticket.status] ?? STATUS.pending;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start gap-2 pb-3 border-b border-border">
        {onBack && <button onClick={onBack} className="p-1 rounded hover:bg-surface-2 text-muted-foreground"><ArrowLeft className="size-4" /></button>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-muted-foreground">{ticket.ref}</span>
            <span className="font-semibold text-sm truncate">{ticket.title}</span>
            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: st.bg }}>{st.label}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{ticket.category} - Sev{ticket.severity} {SEV[ticket.severity] ?? ""} - raised {when(ticket.created_at)}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-3 space-y-2 min-h-[180px]">
        <div className="rounded-lg border border-border bg-surface p-3 text-sm whitespace-pre-wrap">{ticket.description}</div>
        {msgs.map((m) => (
          m.is_system ? (
            <div key={m.id} className="text-center text-[10px] text-muted-foreground py-1">{m.body} - {when(m.created_at)}</div>
          ) : (
            <div key={m.id} className={"flex flex-col max-w-[80%] " + (m.is_admin ? "items-start" : "items-end ml-auto")}>
              <div className={"rounded-2xl px-3 py-2 text-sm " + (m.is_admin ? "bg-surface-2 text-foreground" : "bg-primary text-primary-foreground")}>{m.body}</div>
              <span className="text-[9px] text-muted-foreground mt-0.5">{m.is_admin ? (m.author_name ?? "Support") : (m.author_name ?? "You")} - {when(m.created_at)}</span>
            </div>
          )
        ))}
        <div ref={endRef} />
      </div>

      <div className="pt-3 border-t border-border space-y-2">
        <div className="flex items-center gap-2">
          <input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} placeholder="Write a message..." className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-sm" />
          <button onClick={send} disabled={busy} className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"><Send className="size-4" /></button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin ? (
            <>
              {ticket.status === "pending" && (
                <button onClick={() => setStatus("in_progress", "Picked up - now In progress.")} className="px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-surface-2">Mark in progress</button>
              )}
              {ticket.status !== "resolved" && (
                <button onClick={() => setStatus("resolved", "Marked as resolved.")} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-success text-white">Resolve ticket</button>
              )}
            </>
          ) : (
            ticket.status === "resolved" && (
              <button onClick={reopen} className="px-3 py-1.5 rounded-md text-xs font-semibold border border-destructive/50 text-destructive hover:bg-destructive/10">Re-open (not fixed)</button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
