import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useDrivers, useComplianceWithLedger, useDriverDayHours } from "@/lib/hooks";
import { getDriversSnapshot } from "@/lib/drivers.functions";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { getTenantId } from "@/lib/tenant-insert";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { rotateDriverLoginCode } from "@/lib/pairing.functions";
import { deleteDriver } from "@/lib/drivers-delete.functions";
import { useActiveJobsByDriver } from "@/lib/use-driver-routes";
import { effectiveDriverStatus } from "@/lib/effective-status";
import { useDriverSchedule } from "@/lib/use-driver-schedule";
import { DispatchStat } from "@/components/dispatch/toolbar";
import { DriverQueue } from "@/components/drivers/driver-queue";
import { DriverDetailPanel } from "@/components/drivers/driver-detail-panel";
import { FormField } from "@/components/shared/form-field";

type DriverRouteFilter = "ON_ROUTE" | "ON_SHIFT" | "OFF_SHIFT";
const ALL_DRIVER_ROUTE_FILTERS: DriverRouteFilter[] = ["ON_ROUTE", "ON_SHIFT", "OFF_SHIFT"];
type DriverListFilter = "ALL" | DriverRouteFilter;
const DRIVER_FILTER_STORAGE_KEY = "drivers.routeShiftFilters";
const DRIVER_SEARCH_STORAGE_KEY = "drivers.searchByName";

export const Route = createFileRoute("/_app/drivers")({
  loader: () => getDriversSnapshot(),
  component: DriversPage,
  head: () => ({ meta: [{ title: "Drivers — Planning System" }] }),
});

type DriverForm = { name: string; phone: string };

function DriversPage() {
  const { drivers: initialDrivers } = Route.useLoaderData();
  const drivers = useDrivers(initialDrivers);
  const compliance = useComplianceWithLedger(useDriverDayHours());
  const activeJobsByDriver = useActiveJobsByDriver();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DriverForm>({ name: "", phone: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DriverForm>({ name: "", phone: "" });
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

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
      })
      .select("id, login_code")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Failed to add driver");
      return;
    }
    const code = (data as { login_code?: string | null }).login_code;
    if (code) {
      await navigator.clipboard?.writeText(code).catch(() => {});
      toast.success(`Driver added — code ${code} copied to clipboard`);
    } else {
      toast.success("Driver added");
    }
    setOpen(false);
    setForm({ name: "", phone: "" });
  }

  function startEdit(d: { id: string; name: string; phone: string | null }) {
    setEditingId(d.id);
    setEditForm({ name: d.name, phone: d.phone ?? "" });
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.name) return toast.error("Name required");
    const { error } = await supabase
      .from("drivers")
      .update({
        name: editForm.name,
        phone: editForm.phone || null,
      })
      .eq("id", editingId);
    if (error) toast.error(error.message);
    else {
      toast.success("Driver updated");
      setEditingId(null);
    }
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with filters in the middle */}
      <header className="px-5 py-3 border-b border-border grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Drivers</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filteredDrivers.length} shown of {drivers.length} drivers in roster
          </p>
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
        <div className="flex items-center gap-2 justify-self-end">
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-lg hover:shadow-xl"
          >
            <Plus className="size-4" /> New Driver
          </button>
        </div>
      </header>

      {/* Create form modal */}
      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-semibold mb-1">Add New Driver</h3>
            <p className="text-xs text-muted-foreground mb-5">
              Create a new driver profile and generate their login code.
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-2">
                  Driver Name *
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., John Smith"
                  className="w-full h-10 px-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-2">
                  Phone Number (Optional)
                </label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="e.g., +44 7700 900000"
                  className="w-full h-10 px-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={add}
                className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Create Driver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit driver modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-semibold mb-1">Edit Driver</h3>
            <p className="text-xs text-muted-foreground mb-5">
              Update driver name or phone number.
            </p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-2">
                  Driver Name *
                </label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="e.g., John Smith"
                  className="w-full h-10 px-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-2">
                  Phone Number (Optional)
                </label>
                <input
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  placeholder="e.g., +44 7700 900000"
                  className="w-full h-10 px-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditingId(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="px-5 py-3 border-b border-border">
        <div className="relative max-w-md">
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
              onEdit={(d) => startEdit(d)}
              onDelete={remove}
              onRegenerate={regenerate}
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
