import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Company } from "@/lib/types";
import { SupportTicketThread } from "@/components/support/SupportTicketThread";
import { Search } from "lucide-react";

const sb = supabase as unknown as { from: (t: string) => any };
type Ticket = {
  id: string; ref: string | null; tenant_id: string; created_by_name: string | null;
  created_by_email: string | null; category: string; severity: number; title: string;
  description: string; status: string; attachments: string[]; admin_note: string | null; created_at: string;
};
type Filter = "all" | "pending" | "in_progress" | "resolved";
const SEV: Record<number, string> = { 1: "Critical", 2: "High", 3: "Medium", 4: "Low", 5: "Trivial" };
const SEV_BG: Record<number, string> = { 1: "var(--destructive)", 2: "#ea580c", 3: "var(--warning)", 4: "var(--primary)", 5: "var(--muted-foreground-2)" };
const STATUS: Record<string, { label: string; bg: string }> = {
  pending: { label: "Pending", bg: "var(--destructive)" },
  in_progress: { label: "In progress", bg: "var(--warning)" },
  resolved: { label: "Resolved", bg: "var(--success)" },
};

export function AdminSupportPanel({ companies }: { companies: Company[] }) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [rows, setRows] = useState<Ticket[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies) m.set(c.id, c.name);
    return m;
  }, [companies]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((t) => [t.ref ?? "", t.title, t.category, STATUS[t.status]?.label ?? t.status, nameById.get(t.tenant_id) ?? ""].some((f) => f.toLowerCase().includes(q)));
  }, [rows, search, nameById]);

  const load = useCallback(async () => {
    let q = sb.from("support_tickets")
      .select("id,ref,tenant_id,created_by_name,created_by_email,category,severity,title,description,status,attachments,admin_note,created_at")
      .order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    setRows((data ?? []) as Ticket[]);
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const ch = supabase.channel("rt-support-admin-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const setStatus = async (id: string, status: string) => {
    const { error } = await sb.from("support_tickets").update({ status }).eq("id", id);
    if (error) { toast.error("Could not update status"); return; }
    toast.success("Status updated to " + (STATUS[status]?.label ?? status));
    await load();
  };
  const saveNote = async (id: string) => {
    const { error } = await sb.from("support_tickets").update({ admin_note: note }).eq("id", id);
    if (error) { toast.error("Could not save note"); return; }
    toast.success("Note saved");
    await load();
  };
  const openAttachment = async (path: string) => {
    const { data } = await supabase.storage.from("support-attachments").createSignedUrl(path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Could not open attachment");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(["pending", "in_progress", "resolved", "all"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={"px-3 py-1.5 rounded-md text-xs font-medium border " + (filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground")}>
            {f === "in_progress" ? "In progress" : f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, title, ref, status…" className="h-8 w-64 pl-8 pr-2 rounded-md border border-border bg-surface text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{shown.length} case(s)</span>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">Case</th><th className="px-3 py-2 text-left">Company</th>
            <th className="px-3 py-2 text-left">Sev</th><th className="px-3 py-2 text-left">Category</th>
            <th className="px-3 py-2 text-left">Title</th><th className="px-3 py-2 text-left">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((t) => {
              const st = STATUS[t.status] ?? STATUS.pending;
              const isOpen = openId === t.id;
              return (
                <Fragment key={t.id}>
                  <tr key={t.id} className="hover:bg-surface-2/40 cursor-pointer" onClick={() => { setOpenId(isOpen ? null : t.id); setNote(t.admin_note ?? ""); }}>
                    <td className="px-3 py-2.5 font-mono text-[11px]">{t.ref ?? ""}</td>
                    <td className="px-3 py-2.5">{nameById.get(t.tenant_id) ?? "-"}</td>
                    <td className="px-3 py-2.5"><span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: SEV_BG[t.severity] }}>{t.severity} {SEV[t.severity] ?? ""}</span></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{t.category}</td>
                    <td className="px-3 py-2.5">{t.title}</td>
                    <td className="px-3 py-2.5"><span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: st.bg }}>{st.label}</span></td>
                  </tr>
                  {isOpen && (
                    <tr key={t.id + "-d"} className="bg-surface/40">
                      <td colSpan={6} className="px-4 py-4">
                        {t.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {t.attachments.map((p, i) => (
                              <button key={i} onClick={() => openAttachment(p)} className="text-xs underline text-primary">Attachment {i + 1}</button>
                            ))}
                          </div>
                        )}
                        <div className="h-[55vh]">
                          <SupportTicketThread ticketId={t.id} isAdmin />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">No cases</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
