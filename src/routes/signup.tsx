import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { signUpCompany } from "@/lib/signup.functions";
import { searchCompaniesHouse } from "@/lib/fraud/companies-house.functions";
import { getDeviceId } from "@/lib/device-id";
import brandLogo from "@/assets/brand-logo.png";
import { MailCheck, Search, CheckCircle2, Building2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
  head: () => ({ meta: [{ title: "Start free trial - The Prime Route" }] }),
});

interface ChResult {
  companyNumber: string;
  title: string;
  status?: string;
  addressSnippet?: string;
}

function SignupPage() {
  const signUp = useServerFn(signUpCompany);
  const search = useServerFn(searchCompaniesHouse);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ChResult | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [directorName, setDirectorName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (selected || manualMode) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = (await search({ data: { query: q } })) as ChResult[];
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selected, manualMode, search]);

  const selectCompany = (c: ChResult) => {
    setSelected(c);
    setCompanyName(c.title);
    setResults([]);
    setQuery("");
  };

  const clearSelection = () => {
    setSelected(null);
    setCompanyName("");
  };

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const verificationMethod = selected ? "companies_house" : "manual";
    const finalName = (selected ? selected.title : companyName).trim();
    if (!finalName) {
      setError("Please search for or enter your company.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signUp({
        data: {
          companyName: finalName,
          adminName,
          email,
          password,
          directorName,
          companyNumber: selected ? selected.companyNumber : "",
          companyHouseName: selected ? selected.title : "",
          verificationMethod,
          deviceId: getDeviceId(),
        },
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  const onboardingUrl = import.meta.env.VITE_ONBOARDING_URL as string | undefined;
  const contactEmail =
    (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ?? "hello@theprimeroute.co.uk";
  const alreadyUsed = !!error && error.toLowerCase().includes("already used");

  const field =
    "w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-background">
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

        {sent ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
            <MailCheck className="size-8 text-primary mx-auto mb-3" />
            <div className="text-sm font-semibold">Check your email</div>
            <p className="mt-2 text-xs text-muted-foreground">
              We sent a confirmation link to <b className="text-foreground">{email}</b>. Click it to
              activate your 14-day trial, then log in. The link is required - unconfirmed accounts
              are removed automatically.
            </p>
            {onboardingUrl && (
              <a
                href={onboardingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 block rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Book your free 15-minute onboarding call
              </a>
            )}
            <Link
              to="/login"
              className="mt-3 inline-flex rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-surface-2"
            >
              Go to log in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-surface p-6 space-y-4 shadow-sm">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Your company</label>
              {selected ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium truncate">
                      <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                      <span className="truncate">{selected.title}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">Company no. {selected.companyNumber}</div>
                  </div>
                  <button type="button" onClick={clearSelection} className="text-[11px] text-primary hover:underline shrink-0">
                    Change
                  </button>
                </div>
              ) : manualMode ? (
                <>
                  <input
                    value={companyName}
                    onChange={(ev) => setCompanyName(ev.target.value)}
                    required
                    placeholder="Your company or trading name"
                    className={field}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    We verify manual entries with a quick check - your trial begins right after.{" "}
                    <button type="button" onClick={() => setManualMode(false)} className="text-primary hover:underline">
                      Search Companies House instead
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <div className="relative">
                    <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={query}
                      onChange={(ev) => setQuery(ev.target.value)}
                      placeholder="Search your company name"
                      className={field + " pl-9"}
                    />
                    {searching && (
                      <Loader2 className="size-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
                    )}
                  </div>
                  {results.length > 0 && (
                    <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-background divide-y divide-border">
                      {results.map((r) => (
                        <button
                          key={r.companyNumber}
                          type="button"
                          onClick={() => selectCompany(r)}
                          className="w-full text-left px-3 py-2 hover:bg-surface-2 flex items-start gap-2"
                        >
                          <Building2 className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm truncate">{r.title}</span>
                            <span className="block text-[11px] text-muted-foreground truncate">
                              {r.companyNumber}
                              {r.addressSnippet ? " - " + r.addressSnippet : ""}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Company not listed?{" "}
                    <button type="button" onClick={() => setManualMode(true)} className="text-primary hover:underline">
                      Verify manually
                    </button>
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Owner / Director name</label>
              <input value={directorName} onChange={(ev) => setDirectorName(ev.target.value)} placeholder="Jane Smith" className={field} />
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
              <input type={showPassword ? "text" : "password"} value={password} onChange={(ev) => setPassword(ev.target.value)} required minLength={8} placeholder="At least 8 characters" className={field} />
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground select-none cursor-pointer">
                <input type="checkbox" checked={showPassword} onChange={(ev) => setShowPassword(ev.target.checked)} className="size-3.5 rounded border-border" />
                Show password
              </label>
            </div>
            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
                {alreadyUsed && (
                  <div className="mt-2">
                    <a href={"mailto:" + contactEmail} className="font-semibold underline">
                      Contact us for a personalised demo
                    </a>
                  </div>
                )}
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
        )}
      </div>
    </div>
  );
}
