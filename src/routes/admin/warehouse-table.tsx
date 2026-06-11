import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Warehouse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2, MapPin, Globe, Building2 } from "lucide-react";
import { toast } from "sonner";

interface WarehouseTableProps {
  warehouses: Warehouse[];
  searchQuery: string;
  onRefresh: () => void;
}

interface EditingState {
  code: string;
  name: string;
  latitude: string;
  longitude: string;
  address: string;
}

export function WarehouseTable({ warehouses, searchQuery, onRefresh }: WarehouseTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState>({ code: "", name: "", latitude: "", longitude: "", address: "" });
  const [saving, setSaving] = useState(false);
  const [showDeleteId, setShowDeleteId] = useState<string | null>(null);

  const filtered = warehouses.filter(
    (wh) =>
      !searchQuery ||
      wh.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wh.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (wh.address && wh.address.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  function startEdit(wh: Warehouse) {
    setEditingId(wh.id);
    setEditing({
      code: wh.code,
      name: wh.name,
      latitude: wh.latitude.toString(),
      longitude: wh.longitude.toString(),
      address: wh.address ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleSave(whId: string) {
    if (!editing.code.trim() || !editing.name.trim()) {
      toast.error("Code and name are required");
      return;
    }
    setSaving(true);
    const lat = parseFloat(editing.latitude);
    const lon = parseFloat(editing.longitude);
    if (isNaN(lat) || isNaN(lon)) {
      toast.error("Invalid coordinates");
      setSaving(false);
      return;
    }
    const { error } = await supabase
      .from("warehouses" as never)
      .update({
        code: editing.code.trim(),
        name: editing.name.trim(),
        latitude: lat,
        longitude: lon,
        address: editing.address.trim() || null,
      } as never)
      .eq("id", whId);
    if (error) { toast.error(error.message); setSaving(false); return; }
    toast.success(`Warehouse "${editing.code}" updated`);
    setEditingId(null);
    setSaving(false);
    onRefresh();
  }

  async function handleDelete(whId: string, whCode: string) {
    const { error } = await supabase
      .from("warehouses" as never)
      .delete()
      .eq("id", whId);
    if (error) { toast.error("Failed to delete warehouse"); return; }
    toast.success(`Warehouse "${whCode}" deleted`);
    setShowDeleteId(null);
    onRefresh();
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Globe className="size-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">{searchQuery ? "No warehouses match your search" : "No warehouses yet"}</p>
      </div>
    );
  }

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Location</th>
            <th>Type</th>
            <th>Owner</th>
            <th className="w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((wh) => {
            const isEditing = editingId === wh.id;
            const isGlobal = !(wh as Warehouse & { tenant_id?: string | null }).tenant_id;
            const ownerName = (wh as Warehouse & { companies?: { name: string } | null }).companies?.name;

            return (
              <tr key={wh.id}>
                {isEditing ? (
                  <>
                    <td><Input value={editing.code} onChange={(e) => setEditing((p) => ({ ...p, code: e.target.value }))} className="h-7 text-xs" /></td>
                    <td><Input value={editing.name} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} className="h-7 text-xs" /></td>
                    <td className="space-x-1">
                      <Input value={editing.latitude} onChange={(e) => setEditing((p) => ({ ...p, latitude: e.target.value }))} className="h-7 w-20 text-xs inline-block" />
                      <Input value={editing.longitude} onChange={(e) => setEditing((p) => ({ ...p, longitude: e.target.value }))} className="h-7 w-20 text-xs inline-block" />
                    </td>
                    <td colSpan={2}><Input value={editing.address} onChange={(e) => setEditing((p) => ({ ...p, address: e.target.value }))} placeholder="Address" className="h-7 text-xs" /></td>
                    <td>
                      <div className="flex gap-1">
                        <Button size="sm" variant="default" onClick={() => handleSave(wh.id)} disabled={saving} className="h-7 text-[10px] px-2">{saving ? "..." : "Save"}</Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 text-[10px] px-2">Cancel</Button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="font-semibold text-xs">{wh.code}</td>
                    <td className="text-xs">{wh.name}</td>
                    <td className="text-[11px] font-mono text-muted-foreground">
                      <MapPin className="size-3 inline mr-1 text-muted-foreground/50" />
                      {wh.latitude.toFixed(4)}, {wh.longitude.toFixed(4)}
                      {wh.address && <span className="ml-2 text-muted-foreground/60">{wh.address}</span>}
                    </td>
                    <td>
                      {isGlobal ? (
                        <span className="badge-base badge-warning">GLOBAL</span>
                      ) : (
                        <span className="badge-base badge-muted">COMPANY</span>
                      )}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {ownerName ? (
                        <span className="flex items-center gap-1">
                          <Building2 className="size-3" />
                          {ownerName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">&mdash;</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(wh)} className="p-1 rounded text-primary hover:bg-primary/10 transition-colors">
                          <Pencil className="size-3.5" />
                        </button>
                        {showDeleteId === wh.id ? (
                          <div className="flex gap-1 items-center">
                            <button
                              onClick={() => handleDelete(wh.id, wh.code)}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-destructive text-destructive-foreground"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setShowDeleteId(null)}
                              className="px-2 py-0.5 rounded text-[10px] font-medium border border-border text-muted-foreground"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setShowDeleteId(wh.id)} className="p-1 rounded text-destructive/70 hover:text-destructive hover:bg-destructive/5 transition-colors">
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function WarehouseTableSkeleton() {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Location</th>
            <th>Type</th>
            <th>Owner</th>
            <th className="w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 4 }).map((_, i) => (
            <tr key={i}>
              <td><div className="skeleton h-4 w-12 rounded" /></td>
              <td><div className="skeleton h-4 w-28 rounded" /></td>
              <td><div className="skeleton h-4 w-32 rounded" /></td>
              <td><div className="skeleton h-4 w-14 rounded" /></td>
              <td><div className="skeleton h-4 w-20 rounded" /></td>
              <td><div className="skeleton h-4 w-12 rounded" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
