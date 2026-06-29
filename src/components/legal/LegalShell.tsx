import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { LEGAL_ENTITY } from "@/lib/legal-entity";

/** Shared layout for the public legal pages (refund policy, terms). */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated: {updated}</p>
        <div className="prose prose-sm dark:prose-invert mt-8 max-w-none prose-headings:text-foreground prose-a:text-primary prose-strong:text-foreground">
          {children}
        </div>
        <div className="mt-12 flex flex-wrap gap-4 border-t border-border pt-6 text-sm">
          <Link to="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>
          <Link to="/refund-policy" className="text-primary hover:underline">
            Refund &amp; Cancellation Policy
          </Link>
          <Link to="/privacy-policy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          <Link to="/cookie-policy" className="text-primary hover:underline">
            Cookie Policy
          </Link>
          <Link to="/dpa" className="text-primary hover:underline">
            Data Processing Agreement
          </Link>
          <Link to="/security" className="text-primary hover:underline">
            Security &amp; Trust
          </Link>
        </div>

        <div className="mt-6 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{LEGAL_ENTITY.name}</p>
          {LEGAL_ENTITY.companyNumber && (
            <p>
              Registered in {LEGAL_ENTITY.jurisdiction}. Company number {LEGAL_ENTITY.companyNumber}
              {LEGAL_ENTITY.registeredOffice
                ? ". Registered office: " + LEGAL_ENTITY.registeredOffice + "."
                : "."}
            </p>
          )}
          <p>
            Contact:{" "}
            <a
              href={"mailto:" + LEGAL_ENTITY.supportEmail}
              className="text-primary hover:underline"
            >
              {LEGAL_ENTITY.supportEmail}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
