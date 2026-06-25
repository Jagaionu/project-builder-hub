import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  useDrivers,
  useComplianceWithLedger,
  useDriverDayHours,
  useWarehouses,
  reloadDrivers,
} from "@/lib/hooks";
import { useTheme } from "@/lib/theme-context";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, CalendarDays, Clock, Camera } from "lucide-react";
import { rotateDriverLoginCode } from "@/lib/pairing.functions";
import { deleteDriver } from "@/lib/drivers-delete.functions";
import { useActiveJobsByDriver } from "@/lib/use-driver-routes";
import { effectiveDriverStatus } from "@/lib/effective-status";
import { useDriverSchedule } from "@/lib/use-driver-schedule";
import { DispatchStat, ToolbarButton } from "@/components/dispatch/toolbar";
import { useEquipmentTypes } from "@/lib/use-equipment-types";
import { logActivity } from "@/lib/activity-log";
import { DriverQueue } from "@/components/drivers/driver-queue";
import { DriverDetailPanel } from "@/components/drivers/driver-detail-panel";
import { DispatcherTachographTracker } from "@/components/drivers/DispatcherTachographTracker";
import { FormField } from "@/components/shared/form-field";
import { ShiftPatternEditor } from "@/components/driver/ShiftPatternEditor";
import { fetchShiftPattern } from "@/lib/driver-shifts";

type DriverRouteFilter = "ON_ROUTE" | "ON_SHIFT" | "OFF_SHIFT";
const ALL_DRIVER_ROUTE_FILTERS: DriverRouteFilter[] = ["ON_ROUTE", "ON_SHIFT", "OFF_SHIFT"];
type DriverListFilter = "ALL" | DriverRouteFilter;
const DRIVER_FILTER_STORAGE_KEY = "drivers.routeShiftFilters";
const DRIVER_SEARCH_STORAGE_KEY = "drivers.searchByName";

export const Route = createFileRoute("/_app/drivers")({
  component: DriversPage,
  errorComponent: ({ error, reset }: { error: Error; reset: () => void }) => (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-2xl mx-auto rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <h2 className="text-sm font-semibold text-destructive mb-2">Drivers page crashed</h2>
        <p className="text-xs text-muted-foreground mb-3">{error?.message ?? "Unknown error"}</p>
        <pre className="text-[11px] whitespace-pre-wrap break-words bg-surface border border-border rounded p-3 max-h-[50vh] overflow-auto">
          {error?.stack ?? String(error)}
        </pre>
        <button
          onClick={reset}
          className="mt-3 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          Retry
        </button>
      </div>
    </div>
  ),
  head: () => ({ meta: [{ title: "Drivers — Planning System" }] }),
});

type DriverForm = {
  name: string;
  phone: string;
  home_warehouse_id: string;
  return_to_base_required: boolean;
};

// Chip multi-select for vehicle/equipment types. Options come from the data
// (jobs + driver_equipment) so they match what the planner gates against; a
// free-text "add" lets you introduce a new type when the fleet needs one.
function EquipmentPicker({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const extras = value.filter((v) => !options.includes(v));
  const add = (t: string) => {
    const v = t.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
  };
  const remove = (t: string) => onChange(value.filter((x) => x !== t));
  const addCustom = () => {
    add(custom);
    setCustom("");
    setShowCustom(false);
  };
  return (
    <div className="space-y-2">
      {/* Label row with inline Add (custom field only appears when needed) */}
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground">Vehicle / equipment</label>
        <button
          type="button"
          onClick={() => setShowCustom((v) => !v)}
          className="inline-flex items-center gap-1 px-2 h-7 rounded-md border border-border text-[11px] font-medium hover:bg-surface-2 active:scale-95 transition"
        >
          <Plus className="size-3" /> Add
        </button>
      </div>

      {showCustom && (
        <div className="flex items-center gap-1">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="Custom type…"
            autoFocus
            className="flex-1 h-8 px-2 rounded-md border border-border bg-surface text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="button"
            onClick={addCustom}
            className="px-2 h-8 rounded-md border border-border text-xs hover:bg-surface-2"
          >
            Add
          </button>
        </div>
      )}

      {/* All catalogue types as toggle chips + any custom selections */}
      <div className="flex flex-wrap gap-1.5">
        {options.length === 0 && extras.length === 0 && (
          <span className="text-xs text-muted-foreground">No types yet — use Add.</span>
        )}
        {options.map((o) => {
          const sel = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => (sel ? remove(o) : add(o))}
              className={
                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono border transition active:scale-95 " +
                (sel
                  ? "bg-primary/15 border-primary text-primary"
                  : "border-border text-muted-foreground hover:bg-surface-2")
              }
            >
              {o}
              {sel ? " ✓" : ""}
            </button>
          );
        })}
        {extras.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => remove(o)}
            title="Custom type — click to remove"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono border bg-primary/15 border-primary text-primary"
          >
            {o} ✕
          </button>
        ))}
      </div>
    </div>
  );
}

function DriversPage() {
  const router = useRouter();
  const drivers = useDrivers();
  const { accentColor } = useTheme();
  const warehouses = useWarehouses();
  const compliance = useComplianceWithLedger(useDriverDayHours());
  const activeJobsByDriver = useActiveJobsByDriver();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DriverForm>({
    name: "",
    phone: "",
    home_warehouse_id: "",
    return_to_base_required: false,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DriverForm>({
    name: "",
    phone: "",
    home_warehouse_id: "",
    return_to_base_required: false,
  });
  const [editPattern, setEditPattern] = useState<{
    days: number[];
    times: Record<number, { start_time: string | null; end_time: string | null }>;
  } | null>(null);
  const [editEquip, setEditEquip] = useState<string[]>([]);
  const [createEquip, setCreateEquip] = useState<string[]>([]);
  const equipmentTypes = useEquipmentTypes();
  const eqClient = supabase as unknown as { from: (t: string) => any };
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [tachoOpen, setTachoOpen] = useState(false);

  // ── Drivers list filters (persisted) ────────────────────────────────────
  const [driverListFilter, setDriverListFilter] = useState<DriverListFilter>(() => {
    if (typeof window === "undefined") return "ALL";
    try {
      const raw = localStorage.getItem(DRIVER_FILTER_STORAGE_KEY);
      if (!raw) return "ALL";
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "string") {
        if (parsed === "ALL") return "ALL";
        if (ALL_DRIVER_ROUTE_FILTERS.includes(parsed as DriverRouteFilter))
          return parsed as DriverRouteFilter;
        return "ALL";
      }
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (v): v is DriverRouteFilter =>
            typeof v === "string" && ALL_DRIVER_ROUTE_FILTERS.includes(v as DriverRouteFilter),
        );
        if (valid.length === 3) return "ALL";
        if (valid.length === 1) return valid[0];
        return valid.includes("OFF_SHIFT")
          ? "OFF_SHIFT"
          : valid.includes("ON_SHIFT")
            ? "ON_SHIFT"
            : valid.includes("ON_ROUTE")
              ? "ON_ROUTE"
              : "ALL";
      }
      return "ALL";
    } catch {
      return "ALL";
    }
  });

  const [driverSearch, setDriverSearch] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(DRIVER_SEARCH_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DRIVER_FILTER_STORAGE_KEY, JSON.stringify(driverListFilter));
    } catch {
      /* noop */
    }
  }, [driverListFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(DRIVER_SEARCH_STORAGE_KEY, driverSearch);
    } catch {
      /* noop */
    }
  }, [driverSearch]);

  const nowMs = Date.now();
  const schedule = useDriverSchedule(drivers.map((d) => d.id));
  const driverRows = drivers.map((d) => {
    const effectiveStatus = effectiveDriverStatus(
      d.status,
      activeJobsByDriver[d.id] ?? [],
      nowMs,
      schedule[d.id] ?? "unknown",
    );
    const category: DriverRouteFilter =
      effectiveStatus === "ON_ROUTE"
        ? "ON_ROUTE"
        : effectiveStatus === "OFF_SHIFT"
          ? "OFF_SHIFT"
          : "ON_SHIFT";
    return { d, effectiveStatus, category };
  });

  const q = driverSearch.trim().toLowerCase();
  const driverRowsAfterSearch = driverRows.filter((r) => !q || r.d.name.toLowerCase().includes(q));

  const counts = driverRowsAfterSearch.reduce(
    (acc, r) => {
      acc[r.category] += 1;
      return acc;
    },
    { ON_ROUTE: 0, ON_SHIFT: 0, OFF_SHIFT: 0 } as Record<DriverRouteFilter, number>,
  );

  const filteredDriverRows = driverRowsAfterSearch.filter((r) => {
    if (driverListFilter === "ALL") return true;
    return r.category === driverListFilter;
  });

  const filteredDrivers = filteredDriverRows.map((r) => r.d);
  const pendingPhotos = drivers.filter(
    (d) => (d as { avatar_status?: string | null }).avatar_status === "pending",
  ).length;
  const selectedDriver = selectedDriverId ? drivers.find((d) => d.id === selectedDriverId) : null;

  const rotateCode = useServerFn(rotateDriverLoginCode);
  const removeDriver = useServerFn(deleteDriver);

  async function regenerate(driverId: string, driverName: string) {
    if (
      !confirm(
        `Regenerate login code for "${driverName}"?\n\nThe old code will stop working immediately. The driver will need the new code to log in.`,
      )
    )
      return;
    try {
      const result = await rotateCode({ data: { driverId } });
      const code = (result as { code: string }).code;
      await navigator.clipboard?.writeText(code).catch(() => {});
      toast.success(`New code ${code} — copied to clipboard`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function add() {
    if (!form.name) return toast.error("Name required");
    const tenant_id = await getTenantId();
    const { data, error } = await supabase
      .from("drivers")
      .insert({
        name: form.name,
        phone: form.phone || null,
        status: "OFF_SHIFT",
        tenant_id,
        home_warehouse_id: form.home_warehouse_id || null,
        return_to_base_required: form.return_to_base_required,
      })
      .select("id, login_code")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Failed to add driver");
      return;
    }
    const newId = (data as { id: string }).id;
    if (createEquip.length)
      await eqClient
        .from("driver_equipment")
        .insert(createEquip.map((t) => ({ driver_id: newId, equipment_type: t })));
    void logActivity("driver.create", {
      entityType: "driver",
      entityId: newId,
      entityRef: form.name,
    });
    const code = (data as { login_code?: string | null }).login_code;
    if (code) {
      await navigator.clipboard?.writeText(code).catch(() => {});
      toast.success(`Driver added — code ${code} copied to clipboard`);
    } else {
      toast.success("Driver added");
    }
    setOpen(false);
    setCreateEquip([]);
    setForm({ name: "", phone: "", home_warehouse_id: "", return_to_base_required: false });
    await reloadDrivers();
    router.invalidate();
  }

  function startEdit(d: {
    id: string;
    name: string;
    phone: string | null;
    home_warehouse_id?: string | null;
    return_to_base_required?: boolean;
  }) {
    setEditingId(d.id);
    setEditForm({
      name: d.name,
      phone: d.phone ?? "",
      home_warehouse_id: d.home_warehouse_id ?? "",
      return_to_base_required: d.return_to_base_required ?? false,
    });
    setEditPattern(null);
    setEditEquip([]);
    void (async () => {
      const { data } = await eqClient
        .from("driver_equipment")
        .select("equipment_type")
        .eq("driver_id", d.id);
      setEditEquip(
        ((data ?? []) as Array<{ equipment_type: string }>).map((r) => r.equipment_type),
      );
    })();
    fetchShiftPattern(supabase, d.id)
      .then((p) => {
        setEditPattern({ days: p.days_of_week, times: p.shiftByDay });
      })
      .catch(() => setEditPattern({ days: [], times: {} }));
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.name) return toast.error("Name required");
    const { error } = await supabase
      .from("drivers")
      .update({
        name: editForm.name,
        phone: editForm.phone || null,
        home_warehouse_id: editForm.home_warehouse_id || null,
        return_to_base_required: editForm.return_to_base_required,
      })
      .eq("id", editingId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await eqClient.from("driver_equipment").delete().eq("driver_id", editingId);
    if (editEquip.length)
      await eqClient
        .from("driver_equipment")
        .insert(editEquip.map((t) => ({ driver_id: editingId, equipment_type: t })));
    void logActivity("driver.edit", {
      entityType: "driver",
      entityId: editingId,
      entityRef: editForm.name,
    });
    toast.success("Driver updated");
    setEditingId(null);
    await reloadDrivers();
    router.invalidate();
  }

  async function remove(id: string, name: string) {
    if (
      !confirm(
        `Delete driver "${name}"?\n\nThis removes the driver, their login, GPS history, events and shift records.`,
      )
    )
      return;
    try {
      const removeDriverFn = removeDriver as unknown as (args: {
        data: { driverId: string };
      }) => Promise<unknown>;
      await removeDriverFn({ data: { driverId: id } });
      toast.success("Driver deleted");
      if (selectedDriverId === id) setSelectedDriverId(null);
      await reloadDrivers();
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with filters in the middle */}
      <header
        className="px-5 py-3 border-b border-border grid grid-cols-[1fr_auto_1fr] items-center gap-4"
        style={accentColor ? { background: accentColor } : undefined}
      >
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Drivers</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filteredDrivers.length} shown of {drivers.length} drivers in roster
          </p>
          {pendingPhotos > 0 && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
              <Camera className="size-3" /> {pendingPhotos} photo{pendingPhotos > 1 ? "s" : ""} to
              review
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 justify-self-center">
          <DispatchStat
            label="All"
            value={driverRowsAfterSearch.length}
            color={"var(--muted-foreground)"}
            active={driverListFilter === "ALL"}
            onClick={() => setDriverListFilter("ALL")}
          />
          <DispatchStat
            label="On Route"
            value={counts.ON_ROUTE}
            color={"var(--success)"}
            active={driverListFilter === "ON_ROUTE"}
            onClick={() => setDriverListFilter("ON_ROUTE")}
          />
          <DispatchStat
            label="On Shift"
            value={counts.ON_SHIFT}
            color={"var(--primary)"}
            active={driverListFilter === "ON_SHIFT"}
            onClick={() => setDriverListFilter("ON_SHIFT")}
          />
          <DispatchStat
            label="Off Shift"
            value={counts.OFF_SHIFT}
            color={"var(--muted-foreground-2)"}
            active={driverListFilter === "OFF_SHIFT"}
            onClick={() => setDriverListFilter("OFF_SHIFT")}
          />
        </div>
        <div className="flex flex-col items-end gap-2 justify-self-end">
          <ToolbarButton
            onClick={() => setOpen((o) => !o)}
            primary
            dataAiTarget="add-driver"
            icon={<Plus className="size-3.5" />}
          >
            New Driver
          </ToolbarButton>
        </div>
      </header>

      {tachoOpen && (
        <DispatcherTachographTracker drivers={drivers} onClose={() => setTachoOpen(false)} />
      )}

      {/* Create form modal */}
      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl border border-border/70 shadow-2xl ring-1 ring-black/5 max-w-md w-full p-6 animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-semibold mb-1">Add New Driver</h3>
            <p className="text-xs text-muted-foreground mb-5">
              Create a new driver profile and generate their login code.
            </p>

            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">
                    Driver Name *
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., John Smith"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm transition-colors focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">
                    Phone (Optional)
                  </label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+44 7700 900000"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm transition-colors focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  Home Warehouse (Optional)
                  <span
                    title="Set a home warehouse to have the planner route this driver back there at the end of their shift. Leave as None for a free agent who finishes wherever their last drop is."
                    aria-label="What does home warehouse do?"
                    className="inline-flex items-center justify-center size-4 rounded-full border border-muted-foreground/40 text-[9px] font-bold text-muted-foreground cursor-help"
                  >
                    ?
                  </span>
                </label>
                <select
                  value={form.home_warehouse_id}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      home_warehouse_id: e.target.value,
                      return_to_base_required: !!e.target.value,
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm transition-colors focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                >
                  <option value="">— None (free agent) —</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </div>


              {/* Vehicle / equipment capabilities */}
              <EquipmentPicker value={createEquip} onChange={setCreateEquip} options={equipmentTypes} />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setOpen(false);
                  setCreateEquip([]);
                }}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-sm font-medium active:scale-[0.99] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={add}
                className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-sm hover:bg-primary/90 hover:shadow-md active:scale-[0.99] transition-all"
              >
                Create Driver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit driver modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl border border-border/70 shadow-2xl ring-1 ring-black/5 max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-semibold mb-1">Edit Driver</h3>
            <p className="text-xs text-muted-foreground mb-5">
              Update driver name or phone number.
            </p>
            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">
                    Driver Name *
                  </label>
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="e.g., John Smith"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm transition-colors focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">
                    Phone (Optional)
                  </label>
                  <input
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    placeholder="+44 7700 900000"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm transition-colors focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  Home Warehouse (Optional)
                  <span
                    title="Set a home warehouse to have the planner route this driver back there at the end of their shift. Leave as None for a free agent who finishes wherever their last drop is."
                    aria-label="What does home warehouse do?"
                    className="inline-flex items-center justify-center size-4 rounded-full border border-muted-foreground/40 text-[9px] font-bold text-muted-foreground cursor-help"
                  >
                    ?
                  </span>
                </label>
                <select
                  value={editForm.home_warehouse_id}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      home_warehouse_id: e.target.value,
                      return_to_base_required: !!e.target.value,
                    })
                  }
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm transition-colors focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                >
                  <option value="">— None (free agent) —</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </div>


              {/* Equipment capabilities */}
              <EquipmentPicker value={editEquip} onChange={setEditEquip} options={equipmentTypes} />

              {/* Weekly schedule pattern */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-2 flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" /> Schedule
                </label>
                {editingId && editPattern ? (
                  <ShiftPatternEditor
                    key={`edit-pattern-${editingId}`}
                    driverId={editingId}
                    isPlanner
                    initialDays={editPattern.days}
                    initialTimes={editPattern.times}
                    onSave={() => {
                      // Refresh local snapshot so re-opening reflects saved state.
                      fetchShiftPattern(supabase, editingId).then((p) =>
                        setEditPattern({ days: p.days_of_week, times: p.shiftByDay }),
                      );
                      router.invalidate();
                    }}
                  />
                ) : (
                  <div className="text-xs text-muted-foreground px-3 py-2 rounded-lg border border-border bg-surface/50">
                    Loading schedule…
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditingId(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-sm font-medium active:scale-[0.99] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-sm hover:bg-primary/90 hover:shadow-md active:scale-[0.99] transition-all"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="pl-3 pr-5 py-2.5 border-b border-[color:var(--sidebar-divider)] flex items-center justify-between gap-3">
        <div className="relative w-[340px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={driverSearch}
            onChange={(e) => setDriverSearch(e.target.value)}
            placeholder="Filter by driver name…"
            className="w-full h-9 pl-9 pr-8 rounded-md border border-border bg-surface text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {driverSearch && (
            <button
              onClick={() => setDriverSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
        <ToolbarButton onClick={() => setTachoOpen(true)} icon={<Clock className="size-3.5" />}>
          Tachograph Hours
        </ToolbarButton>
      </div>

      {/* Two-column body */}
      <div className="flex-1 min-h-0 grid grid-cols-[360px_1fr]">
        <DriverQueue
          drivers={filteredDrivers}
          selectedDriverId={selectedDriverId}
          onSelect={setSelectedDriverId}
        />
        <div className="overflow-y-auto bg-background">
          {!selectedDriver ? (
            <div className="h-full grid place-items-center">
              <div className="text-center">
                <div className="size-12 rounded-full grid place-items-center mx-auto mb-3 bg-secondary">
                  <Users className="size-5 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground">Select a driver from the list</p>
              </div>
            </div>
          ) : (
            <DriverDetailPanel
              key={selectedDriver.id}
              driver={selectedDriver}
              activeJobs={activeJobsByDriver[selectedDriver.id] ?? []}
              schedule={schedule[selectedDriver.id] ?? "unknown"}
              compliance={compliance[selectedDriver.id] ?? null}
              onEdit={(d) => startEdit(d)}
              onDelete={remove}
              onRegenerate={regenerate}
              onChanged={async () => {
                await reloadDrivers();
                router.invalidate();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

import { Users } from "lucide-react";

// Re-export FormField as Field for backwards compatibility
export { FormField as Field } from "@/components/shared/form-field";
