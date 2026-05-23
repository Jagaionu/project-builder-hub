import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

const searchSchema = z.object({
  redirect: z.string().optional(),
  error:    z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  component: LoginPage,
});

const ERROR_MESSAGES: Record<string, string> = {
  no_company:        "Your account is not linked to any company. Contact support.",
  company_not_found: "Company configuration error. Contact support.",
};

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo, error: queryError } = useSearch({ from: "/login" });

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(
    queryError ? (ERROR_MESSAGES[queryError] ?? "An error occurred.") : null,
  );

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email:    email.trim().toLowerCase(),
        password,
      });

    if (authError || !authData.session) {
      setError(authError?.message ?? "Sign-in failed");
      setLoading(false);
      return;
    }

    const { data: superAdminRow } = await supabase
      .from("super_admins" as never)
      .select("user_id")
      .eq("user_id", authData.session.user.id)
      .maybeSingle();

    if (superAdminRow) {
      navigate({ to: "/admin", replace: true });
      return;
    }
    navigate({ to: redirectTo ?? "/", replace: true });
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: `
          radial-gradient(ellipse 80% 60% at 50% -10%,
            oklch(0.62 0.22 245 / 0.12) 0%,
            transparent 70%),
          oklch(0.13 0.016 245)
        `,
      }}
    >
      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(oklch(0.26 0.018 245 / 0.3) 1px, transparent 1px),
            linear-gradient(90deg, oklch(0.26 0.018 245 / 0.3) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
        }}
      />

      <div className="relative w-full max-w-sm page-enter">
        {/* Logo / Brand */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div
            className="size-10 rounded-xl grid place-items-center font-mono font-bold text-base text-primary-foreground"
            style={{
              background: "linear-gradient(135deg, oklch(0.62 0.22 245), oklch(0.55 0.20 260))",
              boxShadow: "0 4px 16px oklch(0.62 0.22 245 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.15)",
            }}
          >
            P
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight">Planning System</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              UK Logistics · Dispatch
            </div>
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-7"
          style={{
            background: "oklch(0.17 0.018 245)",
            border: "1px solid oklch(0.24 0.018 245)",
            boxShadow: "0 24px 48px oklch(0 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.04)",
          }}
        >
          <h1 className="text-lg font-semibold tracking-tight mb-1">Sign in</h1>
          <p className="text-xs text-muted-foreground mb-6">
            Access your company's dispatch panel
          </p>

          {error && (
            <div
              className="mb-5 rounded-lg px-3.5 py-2.5 text-xs fade-up"
              style={{
                background: "oklch(0.63 0.22 20 / 0.08)",
                border:     "1px solid oklch(0.63 0.22 20 / 0.3)",
                color:      "oklch(0.72 0.18 20)",
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@company.com"
                className="field-input"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="field-input"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg text-sm font-semibold text-primary-foreground transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: loading
                  ? "oklch(0.50 0.18 245)"
                  : "linear-gradient(135deg, oklch(0.62 0.22 245), oklch(0.56 0.20 255))",
                boxShadow: loading
                  ? "none"
                  : "0 4px 12px oklch(0.62 0.22 245 / 0.35), inset 0 1px 0 oklch(1 0 0 / 0.12)",
              }}
              onMouseEnter={e => {
                if (!loading) e.currentTarget.style.boxShadow = "0 6px 16px oklch(0.62 0.22 245 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.12)";
              }}
              onMouseLeave={e => {
                if (!loading) e.currentTarget.style.boxShadow = "0 4px 12px oklch(0.62 0.22 245 / 0.35), inset 0 1px 0 oklch(1 0 0 / 0.12)";
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="size-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Signing in…
                </span>
              ) : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          Need access?{" "}
          <span className="text-primary cursor-default">Contact your administrator.</span>
        </p>
      </div>
    </div>
  );
}
