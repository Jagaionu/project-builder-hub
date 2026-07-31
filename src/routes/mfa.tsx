import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { regenerateRecoveryCodes, useRecoveryCode } from "@/lib/security/security.functions";
import brandLogo from "@/assets/brand-logo.png";

export const Route = createFileRoute("/mfa")({
  ssr: false,
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/login" });
    const { data: sa } = await supabase
      .from("super_admins" as never)
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (!sa) throw redirect({ to: "/" });
  },
  component: MfaPage,
});

type Mode = "loading" | "enroll" | "challenge" | "codes";

function MfaPage() {
  const navigate = useNavigate();
  const genCodes = useServerFn(regenerateRecoveryCodes);
  const consumeRecovery = useServerFn(useRecoveryCode);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);

  const init = useCallback(async () => {
    setError(null);
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: fdata } = await supabase.auth.mfa.listFactors();
      const totp = ((fdata?.totp ?? []) as Array<{ id: string; status: string }>);
      const verified = totp.find((f) => f.status === "verified");
      if (verified && aal?.currentLevel === "aal2") {
        navigate({ to: "/admin", replace: true });
        return;
      }
      if (verified) {
        setFactorId(verified.id);
        setMode("challenge");
        return;
      }
      for (const f of totp) {
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: en, error: enErr } = await (supabase.auth.mfa.enroll as any)({ factorType: "totp" });
      if (enErr || !en) {
        setError((enErr?.message ?? "Could not start MFA setup") + " (is MFA enabled on the Supabase project?)");
        return;
      }
      setFactorId(en.id);
      setQr(en.totp?.qr_code ?? null);
      setSecret(en.totp?.secret ?? null);
      setMode("enroll");
    } catch (e) {
      setError(e instanceof Error ? e.message : "MFA setup failed");
    }
  }, [navigate]);

  useEffect(() => {
    void init();
  }, [init]);

  async function verifyCode() {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr || !ch) throw new Error(chErr?.message ?? "Challenge failed");
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
      if (vErr) throw new Error(vErr.message);
      if (mode === "enroll") {
        const res = (await genCodes({ data: {} })) as { codes: string[] };
        setCodes(res.codes);
        setMode("codes");
      } else {
        navigate({ to: "/admin", replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code was not valid. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRecovery() {
    setBusy(true);
    setError(null);
    try {
      await consumeRecovery({ data: { code: recovery.trim() } });
      setShowRecovery(false);
      setRecovery("");
      setCode("");
      setMode("loading");
      await init();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid recovery code");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full h-11 px-3 rounded-lg border border-border bg-background text-center text-lg tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="size-10 rounded-xl overflow-hidden grid place-items-center shrink-0">
            <img src={brandLogo} alt="The Prime Route" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight">Two-factor authentication</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Super admin - required</div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm space-y-4">
          {mode === "loading" && <p className="text-sm text-muted-foreground text-center">Loading...</p>}

          {mode === "enroll" && (
            <>
              <p className="text-sm">Scan this QR code with an authenticator app (Google Authenticator, 1Password, Authy...), then enter the 6-digit code.</p>
              {qr && <img src={qr} alt="TOTP QR code" className="mx-auto size-44 bg-white rounded-lg p-2" />}
              {secret && (
                <p className="text-[11px] text-muted-foreground text-center break-all">
                  Or enter this key manually: <span className="font-mono text-foreground">{secret}</span>
                </p>
              )}
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="000000" maxLength={6} className={field} />
              <button onClick={verifyCode} disabled={busy || code.length < 6} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy ? "Verifying..." : "Verify & continue"}
              </button>
            </>
          )}

          {mode === "challenge" && (
            <>
              <p className="text-sm">Enter the 6-digit code from your authenticator app.</p>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="000000" maxLength={6} autoFocus className={field} />
              <button onClick={verifyCode} disabled={busy || code.length < 6} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy ? "Verifying..." : "Verify"}
              </button>
              {!showRecovery ? (
                <button onClick={() => setShowRecovery(true)} className="w-full text-[11px] text-muted-foreground hover:text-foreground underline">
                  Lost your device? Use a recovery code
                </button>
              ) : (
                <div className="space-y-2 pt-2 border-t border-border">
                  <p className="text-[11px] text-muted-foreground">Enter a recovery code. This resets your authenticator so you can set up a new one.</p>
                  <input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="xxxxx-xxxxx" className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm font-mono" />
                  <button onClick={submitRecovery} disabled={busy || recovery.length < 6} className="w-full rounded-lg border border-border py-2 text-xs font-semibold hover:bg-surface-2 disabled:opacity-50">
                    {busy ? "Checking..." : "Use recovery code"}
                  </button>
                </div>
              )}
            </>
          )}

          {mode === "codes" && (
            <>
              <p className="text-sm font-semibold">Save your recovery codes</p>
              <p className="text-[11px] text-muted-foreground">Store these somewhere safe and offline. Each can be used once if you lose your authenticator. They will not be shown again.</p>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-background border border-border p-3 font-mono text-sm">
                {codes.map((c) => (<div key={c}>{c}</div>))}
              </div>
              <button onClick={() => navigate({ to: "/admin", replace: true })} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                I have saved them - continue
              </button>
            </>
          )}

          {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

          <button
            onClick={() => { void supabase.auth.signOut().then(() => { window.location.href = "/login"; }); }}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
