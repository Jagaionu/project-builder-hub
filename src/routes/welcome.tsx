import { createFileRoute, Link } from "@tanstack/react-router";
import brandLogo from "@/assets/brand-logo.png";
import { Truck, MapPin, ShieldCheck, Clock, Route as RouteIcon, ArrowRight, Download, Check } from "lucide-react";

export const Route = createFileRoute("/welcome")({
  component: Welcome,
  head: () => ({
    meta: [
      { title: "The Prime Route - smarter UK logistics dispatch" },
      { name: "description", content: "Plan and assign runs, track every driver live, and stay tachograph compliant. The all-in-one dispatch platform for UK haulage. Start a free trial." },
      { property: "og:title", content: "The Prime Route - UK logistics dispatch" },
      { property: "og:description", content: "Run your fleet, not your spreadsheets. Live tracking, route optimization and tachograph compliance in one place." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://theprimeroute.co.uk/welcome" },
      { property: "og:image", content: "https://theprimeroute.co.uk/web-app-manifest-512x512.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "The Prime Route - UK logistics dispatch" },
      { name: "twitter:description", content: "Run your fleet, not your spreadsheets." },
      { name: "twitter:image", content: "https://theprimeroute.co.uk/web-app-manifest-512x512.png" },
    ],
  }),
});

const FEATURES = [
  { icon: RouteIcon, title: "Plan and optimise", desc: "Auto-assign runs to the right driver and route, in seconds." },
  { icon: MapPin, title: "Live GPS tracking", desc: "See every driver and delivery on a live map, in real time." },
  { icon: ShieldCheck, title: "Stay compliant", desc: "Tachograph and driving-hours limits enforced automatically." },
  { icon: Clock, title: "Hit every window", desc: "Fewer missed CPTs, less idle time, tighter turnarounds." },
];

const POINTS = [
  "Set up in minutes - no spreadsheets, no paperwork",
  "Driver app with live location and job updates",
  "14-day free trial - cancel anytime",
];

function Welcome() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl overflow-hidden grid place-items-center">
            <img src={brandLogo} alt="The Prime Route" className="w-full h-full object-contain" />
          </div>
          <div className="text-sm font-semibold tracking-tight">The Prime Route</div>
        </div>
        <Link to="/login" className="text-sm font-medium text-primary hover:underline">
          Log in
        </Link>
      </header>

      <main className="flex-1">
        <section className="w-full max-w-6xl mx-auto px-6 pt-14 pb-10 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium text-muted-foreground mb-5">
              <Truck className="size-3.5 text-primary" /> UK logistics dispatch platform
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
              Run your fleet, not your spreadsheets.
            </h1>
            <p className="mt-4 text-base text-muted-foreground max-w-md">
              The Prime Route plans your runs, tracks every driver live, and keeps you tachograph
              compliant - so you deliver more with less admin.
            </p>
            <ul className="mt-5 space-y-1.5">
              {POINTS.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm text-foreground/90">
                  <Check className="size-4 text-primary shrink-0" /> {p}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition active:scale-[0.98]"
              >
                Start free trial <ArrowRight className="size-4" />
              </Link>
              <a
                href="/PrimeRoute_Presentation_v3.pptx"
                download
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold hover:bg-surface-2 transition active:scale-[0.98]"
              >
                <Download className="size-4" /> Download presentation
              </a>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Log in
              </Link>
            </p>
          </div>

          <div className="relative hidden lg:block">
            <div className="aspect-[4/3] rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-surface to-surface shadow-xl grid place-items-center overflow-hidden">
              <img src={brandLogo} alt="" className="w-40 h-40 object-contain opacity-90" />
            </div>
          </div>
        </section>

        <section className="w-full max-w-6xl mx-auto px-6 pb-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-surface p-4">
                <f.icon className="size-5 text-primary mb-2" />
                <div className="text-sm font-semibold">{f.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{f.desc}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-surface to-surface p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Ready to try it with your fleet?</div>
              <div className="text-sm text-muted-foreground">Start a free trial today - no card details to look around.</div>
            </div>
            <div className="flex gap-3">
              <Link to="/login" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition">
                Start free trial <ArrowRight className="size-4" />
              </Link>
              <a href="/PrimeRoute_Presentation_v3.pptx" download className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold hover:bg-surface-2 transition">
                <Download className="size-4" /> Presentation
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="w-full max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>The Prime Route - UK logistics dispatch</span>
          <div className="flex gap-4">
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/privacy-policy" className="hover:text-foreground">Privacy</Link>
            <Link to="/login" className="hover:text-foreground">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
