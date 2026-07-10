# Subscription Agreement - Legal Review Checklist

Status: DRAFT - not yet reviewed by a solicitor. Do not rely on the current
wording for live charging until a UK solicitor has signed it off. This checklist
is guidance, not legal advice.

## Where the wording lives
- Agreement text + version: src/lib/subscription-agreement.ts (SUBSCRIPTION_AGREEMENT_VERSION).
- Linked policies: /terms, /refund-policy, /privacy-policy, /dpa (src/routes/*).
- Captured records: public.billing_agreements (Super Admin -> Billing -> Agreements).
- Legal entity details: src/lib/legal-entity.ts.

## Have a UK solicitor confirm
- [ ] The agreement clauses (service, charges, renewal, non-payment, cancellation and refunds, data, IP, liability, governing law) are complete and enforceable for a UK B2B SaaS.
- [ ] Business-customer contracting: every customer contracts as a business, so consumer cancellation rights and the consumer surcharge ban do not apply. Confirm the statement is sufficient.
- [ ] Auto-renewal and cancellation terms are clearly disclosed and fair.
- [ ] The Late Payment of Commercial Debts (Interest) Act 1998 wording (interest, fixed compensation, recovery costs) is correct and enforceable.
- [ ] Personal guarantee wording is enforceable: who is bound, when it is required, and whether a tick is sufficient or a signature or deed is needed.
- [ ] Fee disclosure: passing the payment-processing fee to the customer is lawful for business customers and is shown clearly before payment.
- [ ] VAT invoicing meets HMRC requirements (VAT number and net/VAT/fee breakdown) once VAT-registered.
- [ ] Liability cap and exclusions are reasonable and lawful.
- [ ] Direct Debit Guarantee wording is shown during the GoCardless mandate flow.
- [ ] Data: the DPA and Privacy Policy correctly describe the processor role, UK GDPR, and driver location and tachograph data.

## What to do next (in order)
1. Fill your registered company details in src/lib/legal-entity.ts (company number, registered office) so invoices and policies show the correct legal entity.
2. Send src/lib/subscription-agreement.ts and the four linked policy pages to a UK solicitor for review.
3. Apply their edits to the agreement text and the policy pages.
4. Align the LINKED_POLICIES version dates in src/lib/subscription-agreement.ts with the final policy dates.
5. If any wording changes materially, bump SUBSCRIPTION_AGREEMENT_VERSION. Existing customers are then required to re-accept before their next charge.
6. Confirm charge-before-access is on (GoCardless mandate or card captured up front). In sandbox, run one acceptance + payment and verify the record shows under Billing -> Agreements with View and Download working.
7. Keep the accepted snapshots (billing_agreements) as evidence; they are append-only.
