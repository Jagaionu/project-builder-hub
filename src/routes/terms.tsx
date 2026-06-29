// NOTE: Plain-language Terms template covering the essentials for an early-stage
// B2B SaaS. Have a qualified adviser review before go-live.
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
        credentials secure. You must provide accurate company and billing details. Logins are
        issued per person and are limited to a number of approved devices; sharing a single login
        across multiple people is not permitted.
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
        We process personal data, including operational and location data where applicable, in
        accordance with applicable UK data protection legislation. You retain ownership of all data
        submitted to the Service. You grant us a limited licence to process, store and transmit
        that data solely for the purpose of providing, maintaining and improving the Service. How
        we handle personal data — including driver location data — is described in our{" "}
        <a href="/privacy-policy">Privacy Policy</a>. Where we process personal data on your behalf
        as a processor, our <a href="/dpa">Data Processing Agreement</a> applies.
      </p>

      <h2>6. Intellectual property</h2>
      <p>
        The Service, including its software, design, branding, documentation and underlying
        technology, remains the property of The Prime Route. These Terms do not transfer ownership
        of any intellectual property rights to you.
      </p>

      <h2>7. Service changes</h2>
      <p>
        We may modify, improve or discontinue features of the Service from time to time, provided
        such changes do not materially reduce the core functionality of your active subscription.
      </p>

      <h2>8. Security</h2>
      <p>
        We implement reasonable technical and organisational measures designed to protect customer
        data from unauthorised access, loss or disclosure.
      </p>

      <h2>9. Support</h2>
      <p>Support is provided via email during normal UK business hours.</p>

      <h2>10. Availability</h2>
      <p>
        We work to keep the Service available but do not guarantee uninterrupted access.
        Maintenance and factors outside our control may cause downtime.
      </p>

      <h2>11. Force majeure</h2>
      <p>
        We are not responsible for delays or failures caused by events outside our reasonable
        control, including internet outages, power failures, natural disasters or government action.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        To the extent permitted by law, our total liability arising from the Service is limited to
        the total subscription fees actually paid during the twelve months preceding the claim. We
        are not liable for indirect or consequential loss.
      </p>

      <h2>13. Termination</h2>
      <p>
        We may suspend or terminate access for non-payment or breach of these terms. You may stop
        using the Service at any time by cancelling your subscription.
      </p>

      <h2>14. Entire agreement</h2>
      <p>
        These Terms constitute the entire agreement between the parties and replace any previous
        discussions or understandings relating to the Service.
      </p>

      <h2>15. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be notified to company
        administrators before taking effect.
      </p>

      <h2>16. Notices</h2>
      <p>
        Official notices will be sent to the email address associated with the company
        administrator account.
      </p>

      <h2>17. Governing law</h2>
      <p>These terms are governed by the laws of England and Wales.</p>

      <h2>18. Contact</h2>
      <p>
        Questions about these terms? Email{" "}
        <a href="mailto:support@theprimeroute.co.uk">support@theprimeroute.co.uk</a>.
      </p>
    </LegalShell>
  );
}
