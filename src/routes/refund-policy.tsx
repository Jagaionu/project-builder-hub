// NOTE: Plain-language policy reflecting the implemented pro-rata refund.
// Template — have a qualified adviser review before go-live.
import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "@/components/legal/LegalShell";

export const Route = createFileRoute("/refund-policy")({
  component: RefundPolicyPage,
  head: () => ({ meta: [{ title: "Refund & Cancellation Policy — The Prime Route" }] }),
});

function RefundPolicyPage() {
  return (
    <LegalShell title="Refund & Cancellation Policy" updated="29 June 2026">
      <p>
        The Prime Route is provided as a business-to-business subscription service. This policy
        explains how cancellations and refunds work.
      </p>

      <h2>Free trial</h2>
      <p>
        New companies start on a free trial. No payment is taken during the trial, so nothing is
        charged and no refund is required if you do not continue. When the trial ends, access is
        paused until a subscription is started.
      </p>

      <h2>Cancelling your subscription</h2>
      <p>
        A company administrator can cancel at any time from the <strong>Billing</strong> tab.
        Cancellation takes effect immediately after confirmation by the company administrator.
        Access to the Service ends at that time and the remaining unused subscription period
        becomes eligible for a pro-rata refund in accordance with this policy.
      </p>
      <p>
        Cancellation does not affect any outstanding invoices or amounts already due before the
        cancellation date, which remain payable.
      </p>

      <h2>Pro-rata refund of the unused period</h2>
      <p>
        When you cancel partway through a paid billing period, we refund the{" "}
        <strong>unused portion</strong> of that period, calculated on a daily basis:
      </p>
      <ul>
        <li>
          The refund is the subscription value for the whole days remaining until the end of the
          current period (the daily rate is the period price divided by the number of days in that
          period, so 28-, 29-, 30- and 31-day months are all handled correctly).
        </li>
        <li>
          Any applicable <strong>VAT</strong> is refunded in proportion to the refunded amount.
        </li>
        <li>
          <strong>Payment processing fees</strong> (charged by the card or Direct Debit provider)
          are non-refundable, as they are incurred at the time of payment.
        </li>
      </ul>
      <p>
        Example: on a £120 + VAT monthly plan cancelled exactly halfway through a 30-day month, we
        refund 15 days — £60 plus the VAT on £60 — with the processing fee retained.
      </p>

      <h2>How refunds are paid</h2>
      <p>
        Refunds are returned to your original payment method (card via Stripe, or Direct Debit via
        GoCardless). For bank-transfer customers, the refund is paid back to the account the
        payment came from. Refunds are usually processed within 5–10 business days, depending on
        your payment provider and bank.
      </p>

      <h2>Annual plans</h2>
      <p>
        Annual subscriptions follow the same principle: the unused whole days of the annual period
        are refunded on cancellation, with processing fees retained.
      </p>

      <h2>Failed payments and suspension</h2>
      <p>
        If a renewal payment fails, we attempt to contact you and retry before access is paused. A
        paused account can be restored at any time by completing payment from the Billing tab.
      </p>

      <h2>Your data after cancellation</h2>
      <p>
        After cancellation, your company data will be retained for 30 days to allow export or
        account reactivation, after which it may be permanently deleted unless we are legally
        required to retain it.
      </p>

      <h2>Abuse and fraud</h2>
      <p>
        We reserve the right to refuse refunds where we reasonably believe this policy is being
        abused or used fraudulently (for example, repeated subscribe-and-cancel cycles).
      </p>

      <h2>Contact</h2>
      <p>
        Questions about billing, cancellations, or refunds? Email{" "}
        <a href="mailto:support@theprimeroute.co.uk">support@theprimeroute.co.uk</a>.
      </p>
    </LegalShell>
  );
}
