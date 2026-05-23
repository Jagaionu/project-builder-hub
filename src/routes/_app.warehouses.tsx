import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useWarehouses } from "@/lib/hooks";
import { PageHeader } from "./_app.index";
import { Field } from "./_app.drivers";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { toast } from "sonner";
import {
  Plus, MoreHorizontal, Pencil, Trash2,
  Search, Download, Upload, Warehouse, X,
} from "lucide-react";

export const Route = createFileRoute("/_app/warehouses")({
  component: WarehousesPage,
  head: () => ({ meta: [{ title: "Warehouses — Planning System" }] }),
});

type WForm = { code: string; name: string; latitude: string; longitude: string; address: string };
const empty: WForm = { code: "", name: "", latitude: "", longitude: "", address: "" };

function WarehousesPage() {
  const warehouses  = useWarehouses();
  const [open, setOpen]           = useState(false);
  const [form, setForm]           = useState<WForm>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm]   = useState<WForm>(empty);
  const [query, setQuery]         = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const q        = query.trim().toLowerCase();
  const filtered = q
    ? warehouses.filter((w) => [w.code, w.name, w.address ?? ""].some((f) => f.toLowerCase().includes(q)))
    : warehouses;

  async function add() {
    if (!form.code || !form.name) return toast.error("Code and name required");
    const lat = parseFloat(form.latitude), lon = parseFloat(form.longitude);
    if (isNaN(lat) || isNaN(lon)) return toast.error("Invalid coordinates");
    const code = form.code.toUpperCase().trim();
    if (warehouses.some((w) => w.code.toUpperCase() === code))
      return toast.error(`Warehouse "${code}" already exists`);
    const tenant_id = await getTenantId();
    const { error } = await supabase.from("warehouses").insert({ code, name: form.name, latitude: lat, longitude: lon, address: form.address || null, tenant_id });
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) toast.error(`Warehouse "${code}" already exists`);
      else toast.error(error.message);
    } else { toast.success("Warehouse added"); setOpen(false); setForm(empty); window.location.reload(); }
  }

  function startEdit(w: { id: string; code: string; name: string; latitude: number; longitude: number; address: string | null }) {
    setEditingId(w.id);
    setEditForm({ code: w.code, name: w.name, latitude: String(w.latitude), longitude: String(w.longitude), address: w.address ?? "" });
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.code || !editForm.name) return toast.error("Code and name required");
    const lat = parseFloat(editForm.latitude), lon = parseFloat(editForm.longitude);
    if (isNaN(lat) || isNaN(lon)) return toast.error("Invalid coordinates");
    const code = editForm.code.toUpperCase().trim();
    if (warehouses.some((w) => w.id !== editingId && w.code.toUpperCase() === code))
      return toast.error(`Warehouse "${code}" already exists`);
    const { error } = await supabase.from("warehouses").update({ code, name: editForm.name, latitude: lat, longitude: lon, address: editForm.address || null }).eq("id", editingId);
    if (error) toast.error(error.message);
    else { toast.success("Warehouse updated"); setEditingId(null); window.location.reload(); }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete warehouse "${name}"?`)) return;
    const { error } = await supabase.from("warehouses").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Warehouse deleted"); window.location.reload(); }
  }

  function exportCsv() {
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const rows = [["Code","Name","Address","Coordinates"], ...warehouses.map((w) => [w.code, w.name, w.address ?? "", `${w.latitude}, ${w.longitude}`])];
    const csv  = rows.map((r) => r.map(esc).join(",")).join("\n");
    const a    = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" })), download: `warehouses-${new Date().toISOString().slice(0,10)}.csv` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function parseCsv(text: string): string[][] {
    const rows: string[][] = []; let cur: string[] = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
      else {
        if (c === '"') inQ = true;
        else if (c === ",") { cur.push(field); field = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && text[i+1] === "\n") i++; cur.push(field); field = ""; if (cur.some(v => v.length > 0)) rows.push(cur); cur = []; }
        else field += c;
      }
    }
    if (field.length > 0 || cur.length > 0) { cur.push(field); if (cur.some(v => v.length > 0)) rows.push(cur); }
    return rows;
  }

  async function importCsv(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) { toast.error("CSV is empty"); return; }
      const header = rows[0].map(h => h.trim().toLowerCase());
      const idx    = { code: header.indexOf("code"), name: header.indexOf("name"), address: header.indexOf("address"), coords: header.indexOf("coordinates") };
      if (idx.code < 0 || idx.name < 0 || idx.coords < 0) { toast.error("Expected headers: Code, Name, Address, Coordinates"); return; }
      const tenant_id = await getTenantId();
      const existing  = new Set(warehouses.map(w => w.code.toUpperCase()));
      const inserts: Array<{ code: string; name: string; address: string | null; latitude: number; longitude: number; tenant_id: string | null }> = [];
      const skipped: string[] = [], invalid: string[] = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const code = (r[idx.code] ?? "").trim().toUpperCase();
        const name = (r[idx.name] ?? "").trim();
        const address = idx.address >= 0 ? (r[idx.address] ?? "").trim() : "";
        const coords  = (r[idx.coords] ?? "").trim();
        if (!code || !name) { invalid.push(`Row ${i+1}: missing code/name`); continue; }
        const m = coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (!m) { invalid.push(`Row ${i+1} (${code}): invalid coords`); continue; }
        if (existing.has(code)) { skipped.push(code); continue; }
        existing.add(code);
        inserts.push({ code, name, address: address || null, latitude: parseFloat(m[1]), longitude: parseFloat(m[2]), tenant_id });
      }
      if (inserts.length === 0) { toast.error(`Nothing imported. ${skipped.length} duplicates, ${invalid.length} invalid.`); return; }
      const { error } = await supabase.from("warehouses").insert(inserts);
      if (error) { toast.error(error.message); return; }
      toast.success(`Imported ${inserts.length}. Skipped ${skipped.length} duplicates, ${invalid.length} invalid.`);
      window.location.reload();
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Warehouses"
        subtitle={q ? `${filtered.length} of ${warehouses.length} sites` : `${warehouses.length} sites in network`}
        right={
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); }} />
            <ActionBtn icon={<Download className="size-3.5" />} onClick={exportCsv} disabled={warehouses.length === 0}>
              Export
            </ActionBtn>
            <ActionBtn icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? "Importing…" : "Import"}
            </ActionBtn>
            <ActionBtn icon={<Plus className="size-3.5" />} onClick={() => { setOpen(o => !o); setEditingId(null); }} primary>
              New site
            </ActionBtn>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by code, name or address…"
            className="field-input pl-9 pr-8"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Create form */}
        {open && (
          <div
            className="rounded-xl border p-4 grid grid-cols-6 gap-3 items-end fade-up"
            style={{ background: "oklch(0.17 0.018 245)", borderColor: "oklch(0.62 0.22 245 / 0.3)" }}
          >
            <Field label="Code"      value={form.code}      onChange={(v) => setForm({ ...form, code: v })} />
            <Field label="Name"      value={form.name}      onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Latitude"  value={form.latitude}  onChange={(v) => setForm({ ...form, latitude: v })} />
            <Field label="Longitude" value={form.longitude} onChange={(v) => setForm({ ...form, longitude: v })} />
            <Field label="Address"   value={form.address}   onChange={(v) => setForm({ ...form, address: v })} />
            <div className="flex gap-2">
              <button onClick={add} className="flex-1 h-9 rounded-lg text-xs font-medium text-primary-foreground"
                style={{ background: "oklch(0.62 0.22 245)" }}>
                Create
              </button>
              <button onClick={() => setOpen(false)} className="h-9 px-2 rounded-lg text-xs border border-border hover:bg-surface-2">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Edit form */}
        {editingId && (
          <div
            className="rounded-xl border p-4 grid grid-cols-6 gap-3 items-end fade-up"
            style={{ background: "oklch(0.17 0.018 245)", borderColor: "oklch(0.80 0.18 72 / 0.35)" }}
          >
            <Field label="Code"      value={editForm.code}      onChange={(v) => setEditForm({ ...editForm, code: v })} />
            <Field label="Name"      value={editForm.name}      onChange={(v) => setEditForm({ ...editForm, name: v })} />
            <Field label="Latitude"  value={editForm.latitude}  onChange={(v) => setEditForm({ ...editForm, latitude: v })} />
            <Field label="Longitude" value={editForm.longitude} onChange={(v) => setEditForm({ ...editForm, longitude: v })} />
            <Field label="Address"   value={editForm.address}   onChange={(v) => setEditForm({ ...editForm, address: v })} />
            <div className="flex gap-2">
              <button onClick={saveEdit} className="flex-1 h-9 rounded-lg text-xs font-medium text-primary-foreground"
                style={{ background: "oklch(0.62 0.22 245)" }}>
                Save
              </button>
              <button onClick={() => setEditingId(null)} className="h-9 px-2 rounded-lg text-xs border border-border hover:bg-surface-2">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Address</th>
                <th className="text-right">Coordinates</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr
                  key={w.id}
                  onClick={() => setSelectedId((id) => id === w.id ? null : w.id)}
                  className="cursor-pointer"
                  style={{ background: selectedId === w.id ? "oklch(0.62 0.22 245 / 0.06)" : undefined }}
                >
                  <td>
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-xs font-semibold"
                      style={{
                        background: "oklch(0.62 0.22 245 / 0.10)",
                        color: "oklch(0.75 0.18 245)",
                        border: "1px solid oklch(0.62 0.22 245 / 0.20)",
                      }}
                    >
                      <Warehouse className="size-3" />
                      {w.code}
                    </span>
                  </td>
                  <td className="font-medium">{w.name}</td>
                  <td className="text-muted-foreground text-xs">{w.address ?? "—"}</td>
                  <td className="text-right font-mono text-xs text-muted-foreground">
                    {w.latitude.toFixed(4)}, {w.longitude.toFixed(4)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {selectedId === w.id ? (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => { startEdit(w); setSelectedId(null); }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-xs hover:bg-surface-2"
                        >
                          <Pencil className="size-3" /> Edit
                        </button>
                        <button
                          onClick={() => remove(w.id, w.name)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                          style={{ color: "oklch(0.72 0.18 20)", border: "1px solid oklch(0.63 0.22 20 / 0.35)" }}
                        >
                          <Trash2 className="size-3" /> Del
                        </button>
                      </div>
                    ) : (
                      <RowMenu onEdit={() => startEdit(w)} onDelete={() => remove(w.id, w.name)} />
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-xs text-muted-foreground">
                    {q ? `No results for "${query}"` : "No warehouses yet — add your first site above."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ icon, onClick, disabled, children, primary }: {
  icon: React.ReactNode; onClick: () => void; disabled?: boolean;
  children: React.ReactNode; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      style={primary ? {
        background: "linear-gradient(135deg, oklch(0.62 0.22 245), oklch(0.56 0.20 255))",
        color: "oklch(0.98 0.004 240)",
        boxShadow: "0 2px 8px oklch(0.62 0.22 245 / 0.30)",
      } : {
        background: "oklch(0.17 0.018 245)",
        border: "1px solid oklch(0.26 0.018 245)",
        color: "oklch(0.70 0.010 245)",
      }}
    >
      {icon}{children}
    </button>
  );
}

function RowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-surface-2"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-28 rounded-lg border overflow-hidden z-20"
          style={{
            background: "oklch(0.20 0.020 245)",
            border: "1px solid oklch(0.28 0.020 245)",
            boxShadow: "0 8px 24px oklch(0 0 0 / 0.4)",
          }}
        >
          <button onClick={() => { setOpen(false); onEdit(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 text-left transition-colors">
            <Pencil className="size-3.5 text-muted-foreground" /> Edit
          </button>
          <button onClick={() => { setOpen(false); onDelete(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-destructive/10 text-left transition-colors"
            style={{ color: "oklch(0.72 0.18 20)" }}>
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
