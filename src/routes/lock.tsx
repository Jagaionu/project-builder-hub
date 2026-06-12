import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listDeviceProfiles, profileSignIn } from "@/lib/device-auth.functions";
import brandLogo from "@/assets/brand-logo.png";

export const Route = createFileRoute("/lock")({ component: LockScreen });

const DEVICE_KEY = "device.companyId";
type Profile = { memberId: string; name: string; avatarUrl: string | null };

function LockScreen() {
  const navigate = useNavigate();
  const list = useServerFn(listDeviceProfiles);
  const signIn = useServerFn(profileSignIn);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [picked, setPicked] = useState<Profile | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function exitToLogin() {
    if (typeof window !== "undefined") localStorage.removeItem(DEVICE_KEY);
    navigate({ to: "/login", replace: true });
  }

  useEffect(() => {
    const id = typeof window !== "undefined" ? localStorage.getItem(DEVICE_KEY) : null;
    if (!id) {
      navigate({ to: "/login", replace: true });
      return;
    }
    list({ data: { companyId: id } })
      .then((r) => {
        const rows = r as Profile[];
        // Self-heal: a claimed device with no profiles falls back to the company login.
        if (rows.length === 0) {
          exitToLogin();
          return;
        }
        setProfiles(rows);
      })
      .catch(() => setProfiles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setErr(null);
    try {
      const t = (await signIn({ data: { memberId: picked.memberId, password: pw } })) as {
        access_token: string;
        refresh_token: string;
      };
      const { error } = await supabase.auth.setSession({
        access_token: t.access_token,
        refresh_token: t.refresh_token,
      });
      if (error) throw new Error(error.message);
      window.location.href = "/";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: `
          radial-gradient(ellipse 80% 60% at 50% -10%, oklch(0.62 0.22 245 / 0.04) 0%, transparent 70%),
          var(--background)`,
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(oklch(0.50 0.010 245 / 0.10) 1px, transparent 1px),
            linear-gradient(90deg, oklch(0.50 0.010 245 / 0.10) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
        }}
      />

      <div className="relative w-full max-w-md page-enter">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="size-10 rounded-xl overflow-hidden grid place-items-center shrink-0">
            <img src={brandLogo} alt="Brand logo" className="w-full h-full object-contain" />
          </div>
          <div className="text-center">
            <div className="text-base font-semibold tracking-tight">Who's working?</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Select your profile
            </div>
          </div>
        </div>

        <div
          className="rounded-2xl p-7"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "0 24px 48px oklch(0 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.04)",
          }}
        >
          {!picked ? (
            <div className="flex flex-wrap gap-4 justify-center">
              {profiles.map((p) => (
                <button
                  key={p.memberId}
                  onClick={() => {
                    setPicked(p);
                    setPw("");
                    setErr(null);
                  }}
                  className="flex flex-col items-center gap-2 w-24 group"
                >
                  <span
                    className="size-16 rounded-full grid place-items-center text-xl font-bold overflow-hidden transition-all group-hover:ring-2 group-hover:ring-primary/60"
                    style={{
                      background: "var(--secondary)",
                      color: "var(--muted-foreground)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {p.avatarUrl ? (
                      <img src={p.avatarUrl} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      p.name.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="text-xs truncate w-full text-center">{p.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <form onSubmit={unlock} className="space-y-4">
              <div className="flex flex-col items-center gap-2">
                <span
                  className="size-16 rounded-full grid place-items-center text-xl font-bold overflow-hidden"
                  style={{
                    background: "var(--secondary)",
                    color: "var(--muted-foreground)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {picked.avatarUrl ? (
                    <img
                      src={picked.avatarUrl}
                      alt={picked.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    picked.name.charAt(0).toUpperCase()
                  )}
                </span>
                <p className="text-sm font-semibold">{picked.name}</p>
              </div>

              {err && (
                <div
                  className="rounded-lg px-3.5 py-2.5 text-xs"
                  style={{
                    background: "oklch(0.63 0.22 20 / 0.08)",
                    border: "1px solid oklch(0.63 0.22 20 / 0.3)",
                    color: "var(--destructive-fg)",
                  }}
                >
                  {err}
                </div>
              )}

              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoFocus
                autoComplete="current-password"
                placeholder="Your password"
                className="field-input"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="flex-1 h-10 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy || !pw}
                  className="flex-1 h-10 rounded-lg text-sm font-semibold text-primary-foreground transition-all disabled:opacity-50"
                  style={{
                    background: "linear-gradient(135deg, var(--primary), var(--primary-2))",
                  }}
                >
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </div>
            </form>
          )}
        </div>

        <button
          onClick={exitToLogin}
          className="mt-5 w-full text-center text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          Use a different login
        </button>
      </div>
    </div>
  );
}
