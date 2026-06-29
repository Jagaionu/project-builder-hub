// NOTE: Plain-language Terms template covering the essentials. Have a qualified
// adviser review before go-live.
import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "@/components/legal/LegalShell";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({ meta: [{ title: "Terms of Service — The Prime Route" }] }),
});

function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="29 June 2026">
      <p>
        These terms govern your company&apos;s use of The Prime Route (the &ldquo;Service&rdquo;).
        By creating an account or using the Service you agree to them on behalf of your company.
      </p>

      <h2>1. Accounts</h2>
      <p>
        Your company administrator is responsible for its account, its members, and keeping login
        credentials secure. You must provide accurate company and billing details.
      </p>

      <h2>2. Acceptable use</h2>
      <p>
        You agree not to misuse the Service, attempt to disrupt it, access data belonging to other
        companies, or use it unlawfully. Each company&apos;s data is isolated from every other
        company&apos;s.
      </p>

      <h2>3. Subscriptions and billing</h2>
      <p>
        The Service is sold on a subscription basis to business customers. Prices are shown
        inclusive of any applicable VAT and payment processing fees at checkout. Subscriptions
        renew automatically until cancelled.
      </p>

      <h2>4. Cancellation and refunds</h2>
      <p>
        You may cancel at any time from the Billing tab. Cancellations and pro-rata refunds of the
        unused period are governed by our{" "}
        <a href="/refund-policy">Refund &amp; Cancellation Policy</a>.
      </p>

      <h2>5. Data and privacy</h2>
      <p>
        We process your data in line with applicable UK data protection law. You retain ownership
        of your company&apos;s data and can request export or deletion of personal data in
        accordance with your rights.
      </p>

      <h2>6. Availability</h2>
      <p>
        We work to keep the Service available but do not guarantee uninterrupted access.
        Maintenance and factors outside our control may cause downtime.
      </p>

      <h2>7. Liability</h2>
      <p>
        To the extent permitted by law, our total liability arising from the Service is limited to
        the fees paid by your company in the 12 months before the event giving rise to the claim.
        We are not liable for indirect or consequential loss.
      </p>

      <h2>8. Termination</h2>
      <p>
        We may suspend or terminate access for non-payment or breach of these terms. You may stop
        using the Service at any time by cancelling your subscription.
      </p>

      <h2>9. Governing law</h2>
      <p>These terms are governed by the laws of England and Wales.</p>

      <h2>10. Contact</h2>
      <p>
        Questions about these terms? Email{" "}
        <a href="mailto:support@theprimeroute.co.uk">support@theprimeroute.co.uk</a>.
      </p>
    </LegalShell>
  );
}
