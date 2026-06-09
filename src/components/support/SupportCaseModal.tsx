import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/lib/tenant-context";
import { useServerFn } from "@tanstack/react-start";
import { notifySupportTicket } from "@/lib/support.functions";
import { toast } from "sonner";
import { X, Paperclip, Trash2, Plus, ArrowLeft } from "lucide-react";
import { PersonAvatar } from "@/components/support/PersonAvatar";
import { SupportTicketThread } from "@/components/support/SupportTicketThread";

const CATEGORIES = [
  "GPS / Tracking", "Dispatch / Planning", "Route import (bulk upload)",
  "Drivers / Shifts / Holidays", "Tachograph / Hours", "Login / Access",
  "Billing / Subscription", "Performance", "Data looks wrong", "General",
  "Suggestion (feature request)",
];
const SEVERITIES = [{ v: 1, l: "1 - Critical" }, { v: 2, l: "2 - High" }, { v: 3, l: "3 - Medium" }, { v: 4, l: "4 - Low" }, { v: 5, l: "5 - Trivial" }];
const SEV_BG: Record<number, string> = { 1: "var(--destructive)", 2: "#ea580c", 3: "var(--warning)", 4: "var(--primary)", 5: "var(--muted-foreground-2)" };
const STATUS: Record<string, { label: string; bg: string }> = {
  pending: { label: "Pending", bg: "var(--destructive)" },
  in_progress: { label: "In progress", bg: "var(--warning)" },
  resolved: { label: "Resolved", bg: "var(--success)" },
};
const sb = supabase as unknown as { from: (t: string) => any };
type Ticket = {
  id: string; ref: string | null; severity: number; title: string; status: string;
  assigned_name: string | null; assigned_avatar: string | null;
  created_by_name: string | null; created_by_avatar: string | null;
  created_at: string; updated_at: string;
};
function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : days + " days ago";
}
function dt(iso: string): string { return new Date(iso).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }

export function SupportCaseModal({ onClose }: { onClose: () => void }) {
  const { company, name, email, userId, avatarUrl } = useTenant();
  const tenantId = company?.id ?? null;
  const [view, setView] = useState<"list" | "new" | "thread">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<Ticket[]>([]);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [severity, setSeverity] = useState(3);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const notify = useServerFn(notifySupportTicket);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await sb.from("support_tickets")
      .select("id,ref,severity,title,status,assigned_name,assigned_avatar,created_by_name,created_by_avatar,created_at,updated_at")
      .order("updated_at", { ascending: false }).limit(100);
    setRows((data ?? []) as Ticket[]);
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const ch = supabase.channel("rt-support-list-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const addFiles = (list: FileList | null) => { if (list) setFiles((p) => [...p, ...Array.from(list)].slice(0, 6)); };
  const openThread = (id: string) => { setSelectedId(id); setView("thread"); };

  const submit = async () => {
    if (!tenantId) { toast.error("No company in context"); return; }
    if (!title.trim() || !description.trim()) { toast.error("Add a title and a description"); return; }
    setBusy(true);
    try {
      const paths: string[] = [];
      for (const f of files) {
        const path = `${tenantId}/${crypto.randomUUID()}/${f.name}`;
        const { error } = await supabase.storage.from("support-attachments").upload(path, f, { upsert: false });
        if (!error) paths.push(path);
      }
      const { data, error } = await sb.from("support_tickets").insert({
        tenant_id: tenantId, created_by: userId ?? null, created_by_name: name ?? null,
        created_by_email: email ?? null, created_by_avatar: avatarUrl ?? null,
        category, severity, title: title.trim(), description: description.trim(), attachments: paths,
        context: { page: typeof window !== "undefined" ? window.location.pathname : null },
      }).select("id").single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      try { await notify({ data: { ticketId: id } }); } catch { /* best-effort email */ }
      toast.success("Case submitted - we are on it");
      setTitle(""); setDescription(""); setFiles([]); setCategory(CATEGORIES[0]); setSeverity(3);
      await load(); setView("list");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit the case");
    } finally { setBusy(false); }
  };

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col box-border rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );

  if (view === "thread" && selectedId) {
    return (
      <Shell>
        <div className="p-5 flex flex-col h-[80vh]">
          <SupportTicketThread ticketId={selectedId} isAdmin={false} onBack={() => { setView("list"); setSelectedId(null); }} />
        </div>
      </Shell>
    );
  }

  if (view === "new") {
    return (
      <Shell>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <button onClick={() => setView("list")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Cases</button>
          <h2 className="text-base font-semibold">New ticket</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-10 px-2 rounded-lg border border-border bg-background text-sm">{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Severity</span>
              <select value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-full h-10 px-2 rounded-lg border border-border bg-background text-sm">{SEVERITIES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select></label>
          </div>
          <label className="block mt-3"><span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Problem location</span>
            <input value={company?.name ?? ""} readOnly className="w-full h-10 px-3 rounded-lg border border-border bg-surface text-sm text-muted-foreground" /></label>
          <label className="block mt-3"><span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm" /></label>
          <label className="block mt-3"><span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What happened, what you expected, steps to reproduce" className="w-full box-border p-3 rounded-lg border border-border bg-background text-sm" /></label>
          <div className="mt-3"><span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Attachments</span>
            <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-dashed border-border bg-background text-sm text-muted-foreground cursor-pointer hover:bg-surface-2"><Paperclip className="size-4" /> Add images
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} /></label>
            {files.length > 0 && (<ul className="mt-2 space-y-1">{files.map((f, i) => (<li key={i} className="flex items-center justify-between text-xs rounded border border-border bg-surface px-2 py-1"><span className="truncate">{f.name}</span><button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></li>))}</ul>)}</div>
          <button onClick={submit} disabled={busy} className="mt-4 w-full bg-primary text-primary-foreground font-bold py-3 rounded-xl disabled:opacity-40 active:scale-[0.99] transition">{busy ? "Submitting..." : "Submit case"}</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-base font-semibold">Support cases</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setView("new")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold text-white" style={{ background: "#f97316" }}><Plus className="size-4" /> New ticket</button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground"><X className="size-4" /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left">Sev</th><th className="px-3 py-2 text-left">Short ID</th>
              <th className="px-3 py-2 text-left">Title</th><th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Assignee</th><th className="px-3 py-2 text-left">Age</th>
              <th className="px-3 py-2 text-left">Requester</th><th className="px-3 py-2 text-left">Last updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((t) => {
              const st = STATUS[t.status] ?? STATUS.pending;
              return (
                <tr key={t.id} onClick={() => openThread(t.id)} className="hover:bg-surface-2/40 cursor-pointer">
                  <td className="px-3 py-2.5"><span className="inline-flex items-center justify-center size-5 rounded text-[10px] font-bold text-white" style={{ background: SEV_BG[t.severity] }}>{t.severity}</span></td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-primary">{t.ref ?? ""}</td>
                  <td className="px-3 py-2.5 max-w-[220px] truncate">{t.title}</td>
                  <td className="px-3 py-2.5"><span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: st.bg }}>{st.label}</span></td>
                  <td className="px-3 py-2.5">{t.assigned_name ? (<span className="inline-flex items-center gap-1.5"><PersonAvatar name={t.assigned_name} url={t.assigned_avatar} size={18} /><span className="text-xs">{t.assigned_name}</span></span>) : <span className="text-xs text-muted-foreground">Unassigned</span>}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{ago(t.created_at)}</td>
                  <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><PersonAvatar name={t.created_by_name} url={t.created_by_avatar} size={18} /><span className="text-xs">{t.created_by_name ?? "-"}</span></span></td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{dt(t.updated_at)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (<tr><td colSpan={8} className="px-3 py-10 text-center text-xs text-muted-foreground">No cases yet. Click New ticket to raise one.</td></tr>)}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
