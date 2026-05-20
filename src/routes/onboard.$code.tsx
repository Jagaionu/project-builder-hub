import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Check, Smartphone, MessageCircle, KeyRound } from "lucide-react";

export const Route = createFileRoute("/onboard/$code")({
  component: OnboardPage,
  head: ({ params }) => ({
    meta: [
      { title: "Driver Onboarding" },
      { name: "description", content: `Pair your Telegram with the planning system using code ${params.code}.` },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function OnboardPage() {
  const { code } = Route.useParams();
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const bot = search?.get("bot") || "";
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [copied, setCopied] = useState(false);

  useEffect(() => setPlatform(detectPlatform()), []);

  const installUrl =
    platform === "ios"
      ? "https://apps.apple.com/app/telegram-messenger/id686449807"
      : platform === "android"
        ? "https://play.google.com/store/apps/details?id=org.telegram.messenger"
        : "https://desktop.telegram.org/";

  const botLink = bot ? `https://t.me/${bot}?start=${code}` : `tg://`;

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-md mx-auto px-5 py-10 space-y-8">
        <header className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Driver onboarding</div>
          <h1 className="text-2xl font-semibold">Welcome aboard 🚚</h1>
          <p className="text-sm text-muted-foreground">
            Three quick steps to connect your phone with the dispatch system.
          </p>
        </header>

        <Step n={1} icon={<Smartphone className="size-4" />} title="Install Telegram">
          <p className="text-sm text-muted-foreground mb-3">
            We send all job assignments through Telegram. It's free.
          </p>
          <a
            href={installUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center w-full h-11 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            {platform === "ios" ? "Open App Store" : platform === "android" ? "Open Google Play" : "Download Telegram"}
          </a>
        </Step>

        <Step n={2} icon={<MessageCircle className="size-4" />} title="Open the bot">
          <p className="text-sm text-muted-foreground mb-3">
            After Telegram is installed, tap the button below to open the bot chat.
          </p>
          <a
            href={botLink}
            className="inline-flex items-center justify-center w-full h-11 rounded-md bg-surface border border-border text-sm font-medium hover:bg-surface-2"
          >
            {bot ? `Open @${bot}` : "Open Telegram"}
          </a>
          {!bot && (
            <p className="mt-2 text-xs text-muted-foreground">
              Ask your planner for the bot username if this button doesn't open the right chat.
            </p>
          )}
        </Step>

        <Step n={3} icon={<KeyRound className="size-4" />} title="Send this code to the bot">
          <p className="text-sm text-muted-foreground mb-3">
            In the bot chat, type or paste the 6-digit code below and send it. That's it — you're paired.
          </p>
          <button
            onClick={copy}
            className="w-full h-16 rounded-md border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 flex items-center justify-center gap-3 transition"
          >
            <span className="font-mono text-3xl tracking-[0.4em] text-primary">{code}</span>
            {copied ? <Check className="size-5 text-primary" /> : <Copy className="size-5 text-muted-foreground" />}
          </button>
          <p className="mt-2 text-xs text-muted-foreground text-center">
            Tap the code to copy. Valid for 60 minutes.
          </p>
        </Step>

        <footer className="text-center text-xs text-muted-foreground pt-4">
          Trouble pairing? Reply to your planner with the code.
        </footer>
      </div>
    </div>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="size-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
          {n}
        </div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          {icon} {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
