import { useEffect, useState, type FormEvent } from "react";
import { Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Member = { id: string; name: string | null; email: string | null; user_id: string };

// Switch between this company's profiles. Lists same-tenant members (readable
// via the company_members same-tenant SELECT policy) and re-authenticates with
// the chosen profile's password. NOTE: signInWithPassword replaces the session
// globally, so we reload the app — unsaved changes in other tabs may be lost.
export function ProfileSwitcher({ currentUserId }: { currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [picked, setPicked] = useState<Member | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { data } = await (supabase as unknown as { from: (t: string) => any })
        .from("company_members")
        .select("id, name, email, user_id")
        .order("name", { ascending: true });
      setMembers(((data ?? []) as Member[]).filter((m) => m.email && m.user_id !== currentUserId));
    })();
  }, [open, currentUserId]);

  function close() {
    setOpen(false);
    setPicked(null);
    setPw("");
  }

  async function switchTo(e: FormEvent) {
    e.preventDefault();
    if (!picked?.email) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: picked.email, password: pw });
    if (error) {
      toast.error("Wrong password");
      setBusy(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Switch profile"
        className="size-6 shrink-0 grid place-items-center rounded-md transition-colors"
        style={{ color: "var(--muted-foreground-2)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground-2)")}
      >
        <Users className="size-3.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={close}
        >
          <div
            className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-xs p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                {picked ? "Enter password" : "Switch profile"}
              </h3>
              <button onClick={close} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            {!picked ? (
              members.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No other profiles in this company.
                </p>
              ) : (
                <ul className="space-y-1 max-h-[50vh] overflow-y-auto">
                  {members.map((m) => (
                    <li key={m.id}>
                      <button
                        onClick={() => setPicked(m)}
                        className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2 transition-colors"
                      >
                        <span
                          className="size-7 rounded-md grid place-items-center shrink-0 text-[11px] font-mono font-bold"
                          style={{
                            background: "var(--secondary)",
                            color: "var(--muted-foreground)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          {(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm truncate">{m.name ?? m.email}</span>
                          <span className="block text-[10px] font-mono text-muted-foreground truncate">
                            {m.email}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <form onSubmit={switchTo} className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Password for{" "}
                  <span className="font-medium text-foreground">{picked.name ?? picked.email}</span>
                </p>
                <input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="Password"
                  autoFocus
                  className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-[10px] text-muted-foreground">
                  Switching reloads the app; unsaved changes may be lost.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPicked(null)}
                    className="flex-1 h-9 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !pw}
                    className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
                  >
                    {busy ? "Switching…" : "Switch"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
