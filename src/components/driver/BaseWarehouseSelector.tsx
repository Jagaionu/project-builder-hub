import { useEffect, useState } from "react";
import { Warehouse as WarehouseIcon, RotateCcw } from "lucide-react";
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
  returnToBaseRequired: boolean;
  /** Called after a successful save so parents can refresh local state. */
  onSaved?: (next: { home_warehouse_id: string | null; return_to_base_required: boolean }) => void;
  compact?: boolean;
}

export function BaseWarehouseSelector({
  driverId,
  homeWarehouseId,
  returnToBaseRequired,
  onSaved,
  compact = false,
}: Props) {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(homeWarehouseId);
  const [returnToBase, setReturnToBase] = useState<boolean>(returnToBaseRequired);
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
  useEffect(() => setReturnToBase(returnToBaseRequired), [returnToBaseRequired]);

  const dirty =
    (selectedId ?? null) !== (homeWarehouseId ?? null) ||
    returnToBase !== returnToBaseRequired;

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("drivers")
        .update({
          home_warehouse_id: selectedId,
          return_to_base_required: selectedId ? returnToBase : false,
        })
        .eq("id", driverId);
      if (error) throw error;
      toast.success("Base warehouse saved");
      onSaved?.({
        home_warehouse_id: selectedId,
        return_to_base_required: selectedId ? returnToBase : false,
      });
    } catch (err) {
      toast.error("Couldn't save base warehouse", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  };

  const labelCls = compact
    ? "text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
    : "text-xs font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className={`bg-card/50 border border-border/50 rounded-lg ${compact ? "p-2 space-y-2" : "p-3 space-y-3"}`}>
      <div className="flex items-center gap-2">
        <WarehouseIcon size={compact ? 12 : 14} className="text-muted-foreground" />
        <span className={labelCls}>Base Warehouse</span>
      </div>

      <select
        value={selectedId ?? ""}
        onChange={(e) => setSelectedId(e.target.value || null)}
        className="w-full h-8 px-2 rounded border border-border bg-surface text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">No fixed base (free agent)</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.code} — {w.name}
          </option>
        ))}
      </select>

      {selectedId && (
        <label className="flex items-center gap-2 text-[11px] text-foreground/80 cursor-pointer">
          <input
            type="checkbox"
            checked={returnToBase}
            onChange={(e) => setReturnToBase(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          <RotateCcw size={11} className="text-muted-foreground" />
          Return to base at end of each shift
        </label>
      )}

      {dirty && (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setSelectedId(homeWarehouseId);
              setReturnToBase(returnToBaseRequired);
            }}
            disabled={saving}
            className="flex-1 py-1 rounded-md text-[10px] font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition active:scale-95 disabled:opacity-60"
          >
            Discard
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
      )}
    </div>
  );
}
