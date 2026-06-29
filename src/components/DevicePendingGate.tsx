import { signOut } from "@/lib/auth-context";
import { ShieldAlert } from "lucide-react";

/** Shown when the current device is awaiting (or denied) super-admin approval. */
export function DevicePendingGate() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-4">
          <div className="size-14 rounded-full border-2 border-warning/30 bg-warning/10 grid place-items-center">
            <ShieldAlert className="size-6 text-warning" />
          </div>
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">New device — approval needed</h1>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          For security, this login is limited to a small number of approved devices. This device
          has not been approved yet, so access is paused.
          <br />
          <br />
          Your request has been sent to the administrator for review. You will be able to sign in
          here once it is approved.
        </p>
        <div className="space-y-3">
          <a
            href="mailto:support@theprimeroute.co.uk?subject=New%20device%20approval"
            className="block w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Contact Support
          </a>
          <button
            onClick={signOut}
            className="block w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
