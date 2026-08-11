import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getTrialOptions, startTrialCheckout, confirmTrialPayment } from "@/lib/pricing/trial.functions";
import brandLogo from "@/assets/brand-logo.png";
import { Check, Loader2 } from "lucide-react";

export const Route = createFileRoute("/start-trial")({
  ssr: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validateSearch: (s: Record<string, unknown>) => ({
    status: typeof s.status === "string" ? s.status : undefined,
    session_id: typeof s.session_id === "string" ? s.session_id : undefined,
  }),
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/login" });
    const { data: sa } = await supabase
      .from("super_admins" as never)
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (sa) throw redirect({ to: "/admin" });
  },
  component: StartTrialPage,
});

interface Options {
  currency: string;
  trial7FeeMinor: number;
  trial14FeeMinor: number;
  defaultTrialDays: number;
}

function StartTrialPage() {
  const navigate = useNavigate();
  const { status, session_id } = Route.useSearch();
  const optionsFn = useServerFn(getTrialOptions);
  const startFn = useServerFn(startTrialCheckout);
  const confirmFn = useServerFn(confirmTrialPayment);

  const [opts, setOpts] = useState<Options | null>(null);
  const [phase, setPhase] = useState<"loading" | "choose" | "confirming">("loading");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
    if (status === "success" && session_id) {
      setPhase("confirming");
      try {
        const r = (await confirmFn({ data: { sessionId: session_id } })) as { ok: boolean };
        if (r.ok) {
          navigate({ to: "/", replace: true });
          return;
        }
        setError("We could not confirm your payment. Please try again.");
        setPhase("choose");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Confirmation failed");
        setPhase("choose");
      }
    }
    try {
      const o = (await optionsFn({ data: {} })) as Options;
      setOpts(o);
      if (status !== "success") setPhase("choose");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load trial options");
      setPhase("choose");
    }
  }, [status, session_id, confirmFn, optionsFn, navigate]);

  useEffect(() => {
    void init();
  }, [init]);

  const start = async (days: number) => {
    setBusy(days);
    setError(null);
    try {
      const r = (await startFn({ data: { trialDays: days } })) as { url: string };
      if (r.url) window.location.href = r.url;
      else throw new Error("Could not start checkout");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout");
      setBusy(null);
    }
  };

  const gbp = (m: number) => "£" + (m / 100).toFixed(2);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-background">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="size-10 rounded-xl overflow-hidden grid place-items-center shrink-0">
            <img src={brandLogo} alt="The Prime Route" className="w-full h-full object-contain" />
          </div>
          <div className="text-base font-semibold tracking-tight">Start your trial</div>
        </div>

        {phase === "confirming" ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <Loader2 className="size-6 animate-spin mx-auto text-primary mb-3" />
            <p className="text-sm text-muted-foreground">Confirming your payment…</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground text-center mb-6">
              A small fee starts your trial and is credited to your first month. Then your monthly
              subscription begins - cancel anytime before the trial ends.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { days: 7, fee: opts?.trial7FeeMinor ?? 1000 },
                { days: 14, fee: opts?.trial14FeeMinor ?? 3000 },
              ].map((o) => (
                <div key={o.days} className={"rounded-2xl border bg-surface p-5 flex flex-col " + (o.days === (opts?.defaultTrialDays ?? 7) ? "border-primary" : "border-border")}>
                  <div className="text-sm font-semibold">{o.days}-day trial</div>
                  <div className="mt-2 text-3xl font-bold">{gbp(o.fee)} <span className="text-xs font-normal text-muted-foreground">+ VAT today</span></div>
                  <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground flex-1">
                    <li className="flex items-center gap-1.5"><Check className="size-3.5 text-primary" /> Full access for {o.days} days</li>
                    <li className="flex items-center gap-1.5"><Check className="size-3.5 text-primary" /> Credited to your first month</li>
                    <li className="flex items-center gap-1.5"><Check className="size-3.5 text-primary" /> Cancel anytime before it ends</li>
                  </ul>
                  <button onClick={() => start(o.days)} disabled={busy !== null} className="mt-5 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {busy === o.days ? "Redirecting…" : "Start " + o.days + "-day trial"}
                  </button>
                </div>
              ))}
            </div>
            {error && <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <button onClick={() => { void supabase.auth.signOut().then(() => { window.location.href = "/login"; }); }} className="mt-6 w-full text-[11px] text-muted-foreground hover:text-foreground">
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
