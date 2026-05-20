import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useDrivers } from "@/lib/hooks";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "./_app.index";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X, Send } from "lucide-react";
import { registerTelegramWebhook } from "@/lib/telegram-setup.functions";

export const Route = createFileRoute("/_app/drivers")({
  component: DriversPage,
  head: () => ({ meta: [{ title: "Drivers — Planning System" }] }),
});

type DriverForm = { name: string; phone: string; telegram_id: string };

function DriversPage() {
  const drivers = useDrivers();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DriverForm>({ name: "", phone: "", telegram_id: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DriverForm>({ name: "", phone: "", telegram_id: "" });

  async function add() {
    if (!form.name) return toast.error("Name required");
    const { error } = await supabase.from("drivers").insert({
      name: form.name,
      phone: form.phone || null,
      telegram_id: form.telegram_id || null,
      status: "OFF_SHIFT",
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Driver added");
      setOpen(false);
      setForm({ name: "", phone: "", telegram_id: "" });
    }
  }

  function startEdit(d: { id: string; name: string; phone: string | null; telegram_id: string | null }) {
    setEditingId(d.id);
    setEditForm({ name: d.name, phone: d.phone ?? "", telegram_id: d.telegram_id ?? "" });
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.name) return toast.error("Name required");
    const { error } = await supabase
      .from("drivers")
      .update({
        name: editForm.name,
        phone: editForm.phone || null,
        telegram_id: editForm.telegram_id || null,
      })
      .eq("id", editingId);
    if (error) toast.error(error.message);
    else {
      toast.success("Driver updated");
      setEditingId(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete driver "${name}"?`)) return;
    const { error } = await supabase.from("drivers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Driver deleted");
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Drivers"
        subtitle={`${drivers.length} drivers in roster`}
        right={
          <div className="flex items-center gap-2">
            <SetupTelegramButton />
            <button
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium"
            >
              <Plus className="size-3.5" /> New Driver
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {open && (
          <div className="rounded-md border border-border bg-surface p-4 grid grid-cols-4 gap-3 items-end">
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field
              label="Telegram ID"
              value={form.telegram_id}
              onChange={(v) => setForm({ ...form, telegram_id: v })}
            />
            <button onClick={add} className="h-9 px-3 rounded bg-primary text-primary-foreground text-sm">
              Create
            </button>
          </div>
        )}
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Telegram</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Last Update</th>
                <th className="px-3 py-2 text-right">Coords</th>
                <th className="px-3 py-2 text-right w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {drivers.map((d) => {
                const isEditing = editingId === d.id;
                return (
                  <tr key={d.id} className="hover:bg-surface-2/40">
                    <td className="px-3 py-2.5">
                      {isEditing ? (
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="h-8 px-2 rounded bg-background border border-border text-sm w-full focus:outline-none focus:border-primary"
                        />
                      ) : (
                        d.name
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {isEditing ? (
                        <input
                          value={editForm.phone}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="h-8 px-2 rounded bg-background border border-border text-xs w-full focus:outline-none focus:border-primary"
                        />
                      ) : (
                        (d.phone ?? "—")
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {isEditing ? (
                        <input
                          value={editForm.telegram_id}
                          onChange={(e) => setEditForm({ ...editForm, telegram_id: e.target.value })}
                          className="h-8 px-2 rounded bg-background border border-border text-xs w-full focus:outline-none focus:border-primary"
                        />
                      ) : (
                        (d.telegram_id ?? "—")
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={d.status} kind="driver" />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {d.last_update_time ? new Date(d.last_update_time).toLocaleTimeString() : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {d.current_lat != null ? `${d.current_lat.toFixed(3)}, ${d.current_lon?.toFixed(3)}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={saveEdit}
                              className="p-1.5 rounded hover:bg-surface-2 text-primary"
                              title="Save"
                            >
                              <Check className="size-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground"
                              title="Cancel"
                            >
                              <X className="size-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(d)}
                              className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground"
                              title="Edit"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              onClick={() => remove(d.id, d.name)}
                              className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-9 px-2.5 rounded bg-background border border-border text-sm focus:outline-none focus:border-primary"
      />
    </label>
  );
}

function SetupTelegramButton() {
  const register = useServerFn(registerTelegramWebhook);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await register();
      toast.success(`Telegram webhook set: ${r.url}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border bg-surface text-xs font-medium hover:bg-surface-2 disabled:opacity-50"
    >
      <Send className="size-3.5" /> {busy ? "Setting up…" : "Setup Telegram"}
    </button>
  );
}
