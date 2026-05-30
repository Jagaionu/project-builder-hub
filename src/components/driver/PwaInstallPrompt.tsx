import { useEffect, useState } from "react";
import { Download, X, MoreVertical, Share, ExternalLink } from "lucide-react";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = "hidden" | "install" | "in-app-browser" | "ios-safari";

const DISMISS_KEY = "pwa-install-dismissed-at";
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

function detectInAppBrowser(ua: string): { inApp: boolean; name?: string } {
  const tests: Array<[RegExp, string]> = [
    [/FBAN|FBAV|FB_IAB|FB4A/i, "Facebook"],
    [/Instagram/i, "Instagram"],
    [/Messenger|MessengerLite/i, "Messenger"],
    [/WhatsApp/i, "WhatsApp"],
    [/Line\//i, "LINE"],
    [/TikTok|musical_ly|Bytedance/i, "TikTok"],
    [/Twitter|TwitterAndroid/i, "Twitter/X"],
    [/Snapchat/i, "Snapchat"],
    [/LinkedInApp/i, "LinkedIn"],
    [/Telegram/i, "Telegram"],
  ];
  for (const [re, name] of tests) if (re.test(ua)) return { inApp: true, name };
  return { inApp: false };
}

function isIos(ua: string) {
  return /iPad|iPhone|iPod/i.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
}
function isIosSafari(ua: string) {
  if (!isIos(ua)) return false;
  // Exclude in-app webviews and Chrome/Firefox on iOS
  return !/CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Messenger|WhatsApp|Line\//i.test(ua);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<Mode>("hidden");
  const [inAppName, setInAppName] = useState<string | undefined>();

  useEffect(() => {
    if (isStandalone()) return;

    // Honor previous dismissal
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw && Date.now() - Number(raw) < DISMISS_TTL_MS) return;
    } catch {
      /* noop */
    }

    const ua = navigator.userAgent || "";
    const { inApp, name } = detectInAppBrowser(ua);

    if (inApp) {
      setInAppName(name);
      setMode("in-app-browser");
      return;
    }

    if (isIosSafari(ua)) {
      // iOS doesn't fire beforeinstallprompt — show manual instructions
      setMode("ios-safari");
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setMode("install");
    };

    const handleAppInstalled = () => {
      setMode("hidden");
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setMode("hidden");
        setDeferredPrompt(null);
      } else {
        dismiss();
      }
    } catch (error) {
      console.error("PWA install failed:", error);
      dismiss();
    }
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* noop */
    }
    setMode("hidden");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* noop */
    }
  };

  if (mode === "hidden") return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-[100] animate-in fade-in">
      <div
        className="w-full max-w-md bg-slate-900 rounded-t-2xl p-6 animate-in slide-in-from-bottom-5 shadow-2xl border-t border-slate-800"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        {mode === "install" && (
          <>
            <Header
              icon={<Download className="size-6 text-blue-400" />}
              title="Install Driver App"
              subtitle="Get quick access on your home screen"
              onClose={dismiss}
            />
            <p className="text-sm text-slate-300 mb-6">
              Install the app on your phone for faster access and offline support.
            </p>
            <div className="flex gap-3">
              <button onClick={dismiss} className="flex-1 px-4 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium">
                Not now
              </button>
              <button onClick={handleInstall} className="flex-1 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center justify-center gap-2">
                <Download className="size-4" />
                Install
              </button>
            </div>
          </>
        )}

        {mode === "in-app-browser" && (
          <>
            <Header
              icon={<ExternalLink className="size-6 text-amber-400" />}
              title="Open in your browser"
              subtitle={inAppName ? `You're in ${inAppName}'s in-app browser` : "You're in an in-app browser"}
              onClose={dismiss}
            />
            <p className="text-sm text-slate-300 mb-4">
              To install the Driver App on your phone, open this page in your normal browser first:
            </p>
            <ol className="text-sm text-slate-200 space-y-2 mb-5 list-decimal pl-5">
              <li className="flex items-start gap-2 -ml-5 list-none">
                <span className="font-bold text-blue-400 w-5">1.</span>
                <span>Tap the <MoreVertical className="inline size-4 align-text-bottom" /> menu (three dots) in the top-right corner.</span>
              </li>
              <li className="flex items-start gap-2 -ml-5 list-none">
                <span className="font-bold text-blue-400 w-5">2.</span>
                <span>Choose <strong>"Open in browser"</strong> (Chrome on Android, Safari on iPhone).</span>
              </li>
              <li className="flex items-start gap-2 -ml-5 list-none">
                <span className="font-bold text-blue-400 w-5">3.</span>
                <span>You'll then see the <strong>Install</strong> option here.</span>
              </li>
            </ol>
            <div className="flex gap-3">
              <button onClick={copyLink} className="flex-1 px-4 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium">
                Copy link
              </button>
              <button onClick={dismiss} className="flex-1 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium">
                Got it
              </button>
            </div>
          </>
        )}

        {mode === "ios-safari" && (
          <>
            <Header
              icon={<Share className="size-6 text-blue-400" />}
              title="Add to Home Screen"
              subtitle="Install the Driver App on your iPhone"
              onClose={dismiss}
            />
            <ol className="text-sm text-slate-200 space-y-2 mb-5">
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-400 w-5">1.</span>
                <span>Tap the <Share className="inline size-4 align-text-bottom" /> Share button at the bottom of Safari.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-400 w-5">2.</span>
                <span>Scroll and tap <strong>"Add to Home Screen"</strong>.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-400 w-5">3.</span>
                <span>Tap <strong>Add</strong> in the top-right corner.</span>
              </li>
            </ol>
            <button onClick={dismiss} className="w-full px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium">
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Header({
  icon,
  title,
  subtitle,
  onClose,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-lg bg-blue-500/20 shrink-0">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <p className="text-sm text-slate-400">{subtitle}</p>
        </div>
      </div>
      <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 -m-1">
        <X className="size-5" />
      </button>
    </div>
  );
}
