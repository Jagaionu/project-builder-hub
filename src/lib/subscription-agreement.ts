// Versioned subscription agreement (clickwrap). Binding document a company admin
// must explicitly accept before their first payment. Snapshotted verbatim
// (full text + SHA-256) into billing_agreements at acceptance. Solicitor review
// required before go-live. Bump SUBSCRIPTION_AGREEMENT_VERSION on any material
// change to force re-acceptance before the next charge.

export const SUBSCRIPTION_AGREEMENT_VERSION = "2026-07-09";
export const SUBSCRIPTION_AGREEMENT_EFFECTIVE = "9 July 2026";

export const LINKED_POLICIES = [
  { key: "terms", title: "Terms of Service", href: "/terms", version: "2026-07-09" },
  { key: "refund", title: "Refund and Cancellation Policy", href: "/refund-policy", version: "2026-07-09" },
  { key: "privacy", title: "Privacy Policy", href: "/privacy-policy", version: "2026-07-09" },
  { key: "dpa", title: "Data Processing Agreement", href: "/dpa", version: "2026-07-09" },
] as const;

export function linkedPolicyVersions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of LINKED_POLICIES) out[p.key] = p.version;
  return out;
}

export interface AgreementContext {
  companyName: string;
  plan: string;
  interval: string;
  netMinor: number;
  taxMinor: number;
  feeMinor: number;
  grossMinor: number;
  currency: string;
}

function money(minor: number, currency: string): string {
  const symbol = currency === "GBP" ? "£" : "";
  return symbol + (minor / 100).toFixed(2);
}

export function subscriptionAgreementMarkdown(ctx: AgreementContext): string {
  const each = ctx.interval === "annual" ? "year" : "month";
  const lines: string[] = [
    "# The Prime Route - Subscription Agreement",
    "",
    "**Version " + SUBSCRIPTION_AGREEMENT_VERSION + ", effective " + SUBSCRIPTION_AGREEMENT_EFFECTIVE + ".**",
    "",
    "This Subscription Agreement is between The Prime Route (we, us) and " + ctx.companyName + " (you, the Customer), a business customer. By accepting it you confirm you are authorised to bind the Customer.",
    "",
    "## 1. The service",
    "We provide access to The Prime Route logistics dispatch platform (the Service) on a subscription basis, on the plan and price below and subject to the documents in section 9.",
    "",
    "## 2. Charges",
    "- Plan: **" + ctx.plan + "** (" + ctx.interval + ").",
    "- Net subscription: **" + money(ctx.netMinor, ctx.currency) + "** per " + each + " (excl. VAT).",
    "- VAT: **" + money(ctx.taxMinor, ctx.currency) + "**.",
    "- Payment-processing fee: **" + money(ctx.feeMinor, ctx.currency) + "**.",
    "- **Total per " + each + ": " + money(ctx.grossMinor, ctx.currency) + ".**",
    "",
    "You contract as a business, so the payment-processing fee may be passed on to you; figures are itemised on every invoice and the fee varies with the payment method.",
    "",
    "## 3. Payment and renewal",
    "The subscription is charged in advance and renews automatically each " + each + " until cancelled. You authorise us (via our payment provider) to collect the recurring charge. Access begins once the first payment is authorised.",
    "",
    "## 4. Non-payment",
    "If a payment fails or is not made when due we may suspend or withdraw access after notice. Overdue business debts may attract interest, fixed compensation and reasonable recovery costs under the Late Payment of Commercial Debts (Interest) Act 1998.",
    "",
    "## 5. Cancellation and refunds",
    "You may cancel as set out in the Refund and Cancellation Policy. Cancellation ends access; the unused portion of a paid period is refunded on that policy. Payment-processing fees are non-refundable.",
    "",
    "## 6. Your data",
    "We process your and your drivers personal data (including location and tachograph data) as your processor, under the Data Processing Agreement and Privacy Policy, in compliance with UK GDPR.",
    "",
    "## 7. Intellectual property",
    "We retain all intellectual property in the Service. You receive a non-exclusive, non-transferable licence to use it for the duration of your subscription.",
    "",
    "## 8. Liability",
    "Nothing limits liability that cannot be limited by law. Subject to that, our total liability is capped as set out in the Terms of Service, and we are not liable for indirect or consequential loss.",
    "",
    "## 9. Documents incorporated",
    "This agreement incorporates our Terms of Service, Refund and Cancellation Policy, Privacy Policy and Data Processing Agreement, each as published and versioned at the date of acceptance.",
    "",
    "## 10. Governing law",
    "This agreement is governed by the laws of England and Wales.",
    "",
  ];
  return lines.join("\n");
}
