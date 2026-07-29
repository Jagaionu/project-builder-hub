import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { signUpCompany } from "@/lib/signup.functions";
import brandLogo from "@/assets/brand-logo.png";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
  head: () => ({ meta: [{ title: "Start free trial - The Prime Route" }] }),
});

function SignupPage() {
  const navigate = useNavigate();
  const signUp = useServerFn(signUpCompany);
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signUp({ data: { companyName, adminName, email, password } });
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authErr) throw authErr;
      navigate({ to: "/", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
      setLoading(false);
    }
  }

  const field = "w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="size-10 rounded-xl overflow-hidden grid place-items-center shrink-0">
            <img src={brandLogo} alt="The Prime Route" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight">Start your free trial</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              14 days - no card needed
            </div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-surface p-6 space-y-4 shadow-sm">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Company name</label>
            <input value={companyName} onChange={(ev) => setCompanyName(ev.target.value)} required placeholder="Acme Logistics Ltd" className={field} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Your name</label>
            <input value={adminName} onChange={(ev) => setAdminName(ev.target.value)} required placeholder="Jane Smith" className={field} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Work email</label>
            <input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} required placeholder="you@company.co.uk" className={field} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Password</label>
            <input type="password" value={password} onChange={(ev) => setPassword(ev.target.value)} required minLength={8} placeholder="At least 8 characters" className={field} />
          </div>
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition">
            {loading ? "Creating your account…" : "Start free trial"}
          </button>
          <p className="text-[11px] text-muted-foreground text-center">
            By starting a trial you agree to our{" "}
            <Link to="/terms" className="text-primary hover:underline">Terms</Link> and{" "}
            <Link to="/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>
          <p className="text-[11px] text-muted-foreground text-center">
            Already have an account?{" "}
            <Link to="/login" className="text-primary hover:underline">Log in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
