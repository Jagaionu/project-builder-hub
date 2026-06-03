import { useEffect, useState } from "react";
import { Warehouse as WarehouseIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  driverId: string;
  homeWarehouseId: string | null;
  returnToBaseRequired?: boolean;
  /** Called after a successful save so parents can refresh local state. */
  onSaved?: (next: { home_warehouse_id: string | null; return_to_base_required: boolean }) => void;
  compact?: boolean;
}

// A base warehouse implies "return to base at end of shift": setting a base turns
// the return on, leaving it empty (free agent) turns it off — no separate tick.
// Compact display by default; the dropdown only appears in edit mode.
export function BaseWarehouseSelector({ driverId, homeWarehouseId, onSaved, compact = false }: Props) {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(homeWarehouseId);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("warehouses")
        .select("id,code,name")
        .order("code", { ascending: true });
      if (!cancelled) setWarehouses((data ?? []) as WarehouseOption[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => setSelectedId(homeWarehouseId), [homeWarehouseId]);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("drivers")
        .update({ home_warehouse_id: selectedId, return_to_base_required: !!selectedId })
        .eq("id", driverId);
      if (error) throw error;
      toast.success("Base warehouse saved");
      setEditing(false);
      onSaved?.({ home_warehouse_id: selectedId, return_to_base_required: !!selectedId });
    } catch (err) {
      toast.error("Couldn't save base warehouse", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedWh = warehouses.find((w) => w.id === homeWarehouseId);
  const labelCls = compact
    ? "text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
    : "text-xs font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className={`bg-card/50 border border-border/50 rounded-lg ${compact ? "p-2 space-y-2" : "p-3 space-y-3"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <WarehouseIcon size={compact ? 12 : 14} className="text-muted-foreground" />
          <span className={labelCls}>Base Warehouse</span>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] font-semibold text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="w-full h-8 px-2 rounded border border-border bg-surface text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">No fixed base — no return required</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            Setting a base means you return there at the end of each shift. Leave empty for no return.
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSelectedId(homeWarehouseId);
                setEditing(false);
              }}
              disabled={saving}
              className="flex-1 py-1 rounded-md text-[10px] font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition active:scale-95 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-1 py-1 rounded-md text-[10px] font-semibold bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-60"
            >
              {saving ? "…" : "Save"}
            </button>
          </div>
        </>
      ) : (
        <div
          className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 ${
            homeWarehouseId ? "border-primary/30 bg-primary/10" : "border-border bg-card"
          }`}
        >
          <span className="text-xs font-semibold text-foreground">
            {homeWarehouseId ? (selectedWh ? `${selectedWh.code} — ${selectedWh.name}` : "Loading…") : "No base — no return"}
          </span>
          {homeWarehouseId && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-primary">↩ Return</span>
          )}
        </div>
      )}
    </div>
  );
}
