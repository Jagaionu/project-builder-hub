import { createFileRoute } from "@tanstack/react-router";
import { signOut } from "@/lib/auth-context";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/suspended")({
  component: SuspendedPage,
});

function SuspendedPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-4">
          <div className="size-14 rounded-full border-2 border-destructive/30 bg-destructive/10 grid place-items-center">
            <AlertTriangle className="size-6 text-destructive" />
          </div>
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">Account Suspended</h1>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          Your company's subscription is no longer active. All access to the Planning System has
          been paused.
          <br />
          <br />
          Please contact us to resolve your account status and restore access.
        </p>
        <div className="space-y-3">
          <a
            href="mailto:support@yourcompany.com"
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
