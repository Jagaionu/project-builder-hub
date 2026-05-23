import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useWarehouses } from "@/lib/hooks";
import { PageHeader } from "./_app.index";
import { Field } from "./_app.drivers";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { toast } from "sonner";
import { Plus, MoreHorizontal, Pencil, Trash2, Search, Download, Upload } from "lucide-react";

export const Route = createFileRoute("/_app/warehouses")({
  component: WarehousesPage,
  head: () => ({ meta: [{ title: "Warehouses — Planning System" }] }),
});

type WForm = { code: string; name: string; latitude: string; longitude: string; address: string };
const empty: WForm = { code: "", name: "", latitude: "", longitude: "", address: "" };

function WarehousesPage() {
  const warehouses = useWarehouses();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<WForm>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<WForm>(empty);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? warehouses.filter((w) => [w.code, w.name, w.address ?? ""].some((f) => f.toLowerCase().includes(q)))
    : warehouses;

  async function add() {
    if (!form.code || !form.name) return toast.error("Code and name required");
    const lat = parseFloat(form.latitude),
      lon = parseFloat(form.longitude);
    if (isNaN(lat) || isNaN(lon)) return toast.error("Invalid coordinates");
    const code = form.code.toUpperCase().trim();
    if (warehouses.some((w) => w.code.toUpperCase() === code)) {
      return toast.error(`A warehouse with code "${code}" already exists`);
    }
    const tenant_id = await getTenantId();
    const { error } = await supabase.from("warehouses").insert({
      code,
      name: form.name,
      latitude: lat,
      longitude: lon,
      address: form.address || null,
      tenant_id,
    });
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
        toast.error(`A warehouse with code "${code}" already exists`);
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success("Warehouse added");
      setOpen(false);
      setForm(empty);
      window.location.reload();
    }
  }

  function startEdit(w: {
    id: string;
    code: string;
    name: string;
    latitude: number;
    longitude: number;
    address: string | null;
  }) {
    setEditingId(w.id);
    setEditForm({
      code: w.code,
      name: w.name,
      latitude: String(w.latitude),
      longitude: String(w.longitude),
      address: w.address ?? "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.code || !editForm.name) return toast.error("Code and name required");
    const lat = parseFloat(editForm.latitude),
      lon = parseFloat(editForm.longitude);
    if (isNaN(lat) || isNaN(lon)) return toast.error("Invalid coordinates");
    const code = editForm.code.toUpperCase().trim();
    if (warehouses.some((w) => w.id !== editingId && w.code.toUpperCase() === code)) {
      return toast.error(`A warehouse with code "${code}" already exists`);
    }
    const { error } = await supabase
      .from("warehouses")
      .update({
        code,
        name: editForm.name,
        latitude: lat,
        longitude: lon,
        address: editForm.address || null,
      })
      .eq("id", editingId);
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
        toast.error(`A warehouse with code "${code}" already exists`);
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success("Warehouse updated");
      setEditingId(null);
      window.location.reload();
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete warehouse "${name}"?`)) return;
    const { error } = await supabase.from("warehouses").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Warehouse deleted");
      window.location.reload();
    }
  }

  function csvEscape(v: string) {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv() {
    const header = ["Code", "Name", "Address", "Coordinates"];
    const rows = warehouses.map((w) => [
      w.code,
      w.name,
      w.address ?? "",
      `${w.latitude}, ${w.longitude}`,
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warehouses-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let cur: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { cur.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          cur.push(field); field = "";
          if (cur.some((v) => v.length > 0)) rows.push(cur);
          cur = [];
        } else field += c;
      }
    }
    if (field.length > 0 || cur.length > 0) { cur.push(field); if (cur.some((v) => v.length > 0)) rows.push(cur); }
    return rows;
  }

  async function importCsv(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) { toast.error("CSV is empty"); return; }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const idx = {
        code: header.indexOf("code"),
        name: header.indexOf("name"),
        address: header.indexOf("address"),
        coords: header.indexOf("coordinates"),
      };
      if (idx.code < 0 || idx.name < 0 || idx.coords < 0) {
        toast.error("Expected headers: Code, Name, Address, Coordinates");
        return;
      }
      const tenant_id = await getTenantId();
      const existingCodes = new Set(warehouses.map((w) => w.code.toUpperCase()));
      const inserts: Array<{ code: string; name: string; address: string | null; latitude: number; longitude: number; tenant_id: string | null }> = [];
      const skipped: string[] = [];
      const invalid: string[] = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const code = (r[idx.code] ?? "").trim().toUpperCase();
        const name = (r[idx.name] ?? "").trim();
        const address = idx.address >= 0 ? (r[idx.address] ?? "").trim() : "";
        const coords = (r[idx.coords] ?? "").trim();
        if (!code || !name) { invalid.push(`Row ${i + 1}: missing code/name`); continue; }
        const m = coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (!m) { invalid.push(`Row ${i + 1} (${code}): invalid coordinates "${coords}"`); continue; }
        const lat = parseFloat(m[1]); const lon = parseFloat(m[2]);
        if (existingCodes.has(code)) { skipped.push(code); continue; }
        existingCodes.add(code);
        inserts.push({ code, name, address: address || null, latitude: lat, longitude: lon, tenant_id });
      }
      if (inserts.length === 0) {
        toast.error(`Nothing imported. ${skipped.length} duplicates, ${invalid.length} invalid.`);
        if (invalid.length) console.warn("Invalid rows:", invalid);
        return;
      }
      const { error } = await supabase.from("warehouses").insert(inserts);
      if (error) { toast.error(error.message); return; }
      toast.success(`Imported ${inserts.length} warehouses. Skipped ${skipped.length} duplicates, ${invalid.length} invalid.`);
      if (invalid.length) console.warn("Invalid rows:", invalid);
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); }}
            />
            <button
              onClick={exportCsv}
              disabled={warehouses.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border bg-surface text-xs font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              <Download className="size-3.5" /> Export CSV
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border bg-surface text-xs font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              <Upload className="size-3.5" /> {importing ? "Importing…" : "Import CSV"}
            </button>
            <button
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium"
            >
              <Plus className="size-3.5" /> New Warehouse
            </button>
          </div>
        }

      />
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="relative max-w-md">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by location, code, or address…"
            className="w-full h-9 pl-9 pr-8 rounded-md border border-border bg-surface text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
        {open && (
          <div className="rounded-md border border-border bg-surface p-4 grid grid-cols-6 gap-3 items-end">
            <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Latitude" value={form.latitude} onChange={(v) => setForm({ ...form, latitude: v })} />
            <Field label="Longitude" value={form.longitude} onChange={(v) => setForm({ ...form, longitude: v })} />
            <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            <button onClick={add} className="h-9 px-3 rounded bg-primary text-primary-foreground text-sm">
              Create
            </button>
          </div>
        )}
        {editingId && (
          <div className="rounded-md border border-primary/40 bg-surface p-4 grid grid-cols-6 gap-3 items-end">
            <Field label="Code" value={editForm.code} onChange={(v) => setEditForm({ ...editForm, code: v })} />
            <Field label="Name" value={editForm.name} onChange={(v) => setEditForm({ ...editForm, name: v })} />
            <Field
              label="Latitude"
              value={editForm.latitude}
              onChange={(v) => setEditForm({ ...editForm, latitude: v })}
            />
            <Field
              label="Longitude"
              value={editForm.longitude}
              onChange={(v) => setEditForm({ ...editForm, longitude: v })}
            />
            <Field
              label="Address"
              value={editForm.address}
              onChange={(v) => setEditForm({ ...editForm, address: v })}
            />
            <div className="flex gap-2">
              <button onClick={saveEdit} className="h-9 px-3 rounded bg-primary text-primary-foreground text-sm">
                Save
              </button>
              <button onClick={() => setEditingId(null)} className="h-9 px-3 rounded border border-border text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="rounded-md border border-border overflow-visible">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Address</th>
                <th className="px-3 py-2 text-right">Coordinates</th>
                <th className="px-3 py-2 text-right w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((w) => (
                <tr
                  key={w.id}
                  onClick={() => setSelectedId((id) => (id === w.id ? null : w.id))}
                  className={`hover:bg-surface-2/40 cursor-pointer ${selectedId === w.id ? "bg-surface-2/60" : ""}`}
                >
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold">{w.code}</td>
                  <td className="px-3 py-2.5">{w.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{w.address ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {w.latitude.toFixed(4)}, {w.longitude.toFixed(4)}
                  </td>
                  <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    {selectedId === w.id ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => {
                            startEdit(w);
                            setSelectedId(null);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-surface-2 text-xs"
                        >
                          <Pencil className="size-3.5" /> Edit
                        </button>
                        <button
                          onClick={() => remove(w.id, w.name)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10 text-xs"
                        >
                          <Trash2 className="size-3.5" /> Delete
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
                  <td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No warehouses match "{query}"
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

function RowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground"
        title="Actions"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-32 rounded-md border border-border bg-surface shadow-lg z-20 overflow-hidden">
          <button
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 text-left"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 text-left text-destructive"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
