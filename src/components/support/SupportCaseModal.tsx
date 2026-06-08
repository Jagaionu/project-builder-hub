import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/lib/tenant-context";
import { useServerFn } from "@tanstack/react-start";
import { notifySupportTicket } from "@/lib/support.functions";
import { toast } from "sonner";
import { X, Paperclip, Trash2 } from "lucide-react";
import { SupportTicketThread } from "@/components/support/SupportTicketThread";

const CATEGORIES = [
  "GPS / Tracking", "Dispatch / Planning", "Route import (bulk upload)",
  "Drivers / Shifts / Holidays", "Tachograph / Hours", "Login / Access",
  "Billing / Subscription", "Performance", "Data looks wrong", "General",
  "Suggestion (feature request)",
];
const SEVERITIES = [
  { v: 1, l: "1 - Critical" }, { v: 2, l: "2 - High" }, { v: 3, l: "3 - Medium" },
  { v: 4, l: "4 - Low" }, { v: 5, l: "5 - Trivial" },
];
const STATUS: Record<string, { label: string; bg: string }> = {
  pending:     { label: "Pending",     bg: "var(--destructive)" },
  in_progress: { label: "In progress", bg: "var(--warning)" },
  resolved:    { label: "Resolved",    bg: "var(--success)" },
};

const sb = supabase as unknown as { from: (t: string) => any };
type Ticket = { id: string; ref: string | null; title: string; category: string; severity: number; status: string; created_at: string; admin_note: string | null };

export function SupportCaseModal({ onClose }: { onClose: () => void }) {
  const { company, name, email, userId } = useTenant();
  const tenantId = company?.id ?? null;
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [severity, setSeverity] = useState(3);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Ticket[]>([]);
  const notify = useServerFn(notifySupportTicket);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    const load = async () => {
      const { data } = await sb.from("support_tickets")
        .select("id,ref,title,category,severity,status,created_at,admin_note")
        .order("created_at", { ascending: false }).limit(20);
      setMine((data ?? []) as Ticket[]);
    };
    void load();
    const ch = supabase.channel("rt-support-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 6));
  };

  const submit = async () => {
    if (!tenantId) { toast.error("No company in context"); return; }
    if (!title.trim() || !description.trim()) { toast.error("Add a title and a description"); return; }
    setBusy(true);
    try {
      const paths: string[] = [];
      for (const f of files) {
        const path = `${tenantId}/${crypto.randomUUID()}/${f.name}`;
        const { error } = await supabase.storage.from("support-attachments").upload(path, f, { upsert: false });
        if (error) { console.warn("[support] upload failed", error); continue; }
        paths.push(path);
      }
      const { data, error } = await sb.from("support_tickets").insert({
        tenant_id: tenantId, created_by: userId ?? null,
        created_by_name: name ?? null, created_by_email: email ?? null,
        category, severity, title: title.trim(), description: description.trim(),
        attachments: paths,
        context: { page: typeof window !== "undefined" ? window.location.pathname : null, ua: typeof navigator !== "undefined" ? navigator.userAgent : null },
      }).select("id").single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      try { await notify({ data: { ticketId: id } }); } catch { /* email is best-effort */ }
      toast.success("Case submitted - we are on it");
      setTitle(""); setDescription(""); setFiles([]); setCategory(CATEGORIES[0]); setSeverity(3);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit the case");
    } finally { setBusy(false); }
  };

  if (selectedId) {
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={onClose}>
        <div className="w-full max-w-lg h-[80vh] box-border rounded-2xl border border-border bg-card p-5 shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
          <SupportTicketThread ticketId={selectedId} isAdmin={false} onBack={() => setSelectedId(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto box-border rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Create a case</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground"><X className="size-4" /></button>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">Report a problem or suggest an improvement. Add a screenshot if it helps.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-10 px-2 rounded-lg border border-border bg-background text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Severity</span>
            <select value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-full h-10 px-2 rounded-lg border border-border bg-background text-sm">
              {SEVERITIES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </label>
        </div>
        <label className="block mt-3">
          <span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Problem location</span>
          <input value={company?.name ?? ""} readOnly className="w-full h-10 px-3 rounded-lg border border-border bg-surface text-sm text-muted-foreground" />
        </label>
        <label className="block mt-3">
          <span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm" />
        </label>
        <label className="block mt-3">
          <span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What happened, what you expected, steps to reproduce" className="w-full box-border p-3 rounded-lg border border-border bg-background text-sm" />
        </label>
        <div className="mt-3">
          <span className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Attachments</span>
          <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-dashed border-border bg-background text-sm text-muted-foreground cursor-pointer hover:bg-surface-2">
            <Paperclip className="size-4" /> Add images
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          </label>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-xs rounded border border-border bg-surface px-2 py-1">
                  <span className="truncate">{f.name}</span>
                  <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={submit} disabled={busy} className="mt-4 w-full bg-primary text-primary-foreground font-bold py-3 rounded-xl disabled:opacity-40 active:scale-[0.99] transition">
          {busy ? "Submitting..." : "Submit case"}
        </button>
        {mine.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Your recent cases</h3>
            <ul className="space-y-1.5">
              {mine.map((t) => {
                const st = STATUS[t.status] ?? STATUS.pending;
                return (
                  <li key={t.id} onClick={() => setSelectedId(t.id)} className="flex items-center gap-2 text-xs rounded-lg border border-border bg-surface px-2.5 py-2 cursor-pointer hover:bg-surface-2">
                    <span className="font-mono text-[10px] text-muted-foreground">{t.ref ?? ""}</span>
                    <span className="flex-1 truncate text-foreground">{t.title}</span>
                    <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: st.bg }}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
