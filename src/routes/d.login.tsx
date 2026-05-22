import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { loginWithPairingCode } from "@/lib/driver-auth";

export const Route = createFileRoute("/d/login")({
  head: () => ({ meta: [{ title: "Sign in — Driver" }] }),
  component: DriverLogin,
});

function DriverLogin() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = code.replace(/\D/g, "").slice(0, 6);

  const handleSubmit = async () => {
    if (digits.length !== 6) return;
    setLoading(true); setError(null);
    try {
      await loginWithPairingCode(digits);
      navigate({ to: "/d" });
    } catch (e) {
      setError((e as Error).message ?? "Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="mb-10 text-center">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-card border border-border flex items-center justify-center mb-4">
          <span className="text-4xl">🚚</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Driver App</h1>
        <p className="text-sm text-muted-foreground mt-1">Enter your pairing code to get started</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
            6-Digit Pairing Code
          </label>
          <input
            type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
            value={digits}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="000000"
            className="w-full bg-card border border-border rounded-xl px-4 py-4 text-center text-3xl font-mono tracking-[0.5em] text-foreground placeholder-border focus:outline-none focus:border-primary transition-colors"
          />
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Ask dispatch for your code.
          </p>
        </div>

        {error && (
          <div className="bg-destructive/15 border border-destructive/40 rounded-xl px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <button onClick={handleSubmit} disabled={digits.length !== 6 || loading}
          className="w-full bg-primary text-primary-foreground font-semibold rounded-xl py-4 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] transition">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
