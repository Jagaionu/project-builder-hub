// Pure dunning email content. No I/O — fully testable. Each step includes a
// direct link to the customer billing page to update the payment method.
import type { DunningStep } from "./state-machine";

export interface DunningTemplateArgs {
  companyName: string;
  invoiceRef: string;
  amountFormatted: string;
  billingUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function dunningTemplate(step: DunningStep, a: DunningTemplateArgs): RenderedEmail {
  switch (step) {
    case "day1":
      return build(
        `Action needed: payment failed for ${a.invoiceRef}`,
        `Hi ${a.companyName},`,
        `We couldn't take payment of ${a.amountFormatted} for invoice ${a.invoiceRef}. ` +
          `This is often an expired card or insufficient funds. Please update your payment method to avoid any interruption.`,
        a.billingUrl,
        "Update payment method",
      );
    case "day3":
      return build(
        `Reminder: ${a.invoiceRef} is still unpaid`,
        `Hi ${a.companyName},`,
        `We've still not been able to collect ${a.amountFormatted} for invoice ${a.invoiceRef}. ` +
          `Please update your payment details soon to keep your account active.`,
        a.billingUrl,
        "Update payment method",
      );
    case "suspended_warning":
      return build(
        `Final notice: ${a.invoiceRef} — account at risk of suspension`,
        `Hi ${a.companyName},`,
        `Invoice ${a.invoiceRef} for ${a.amountFormatted} remains unpaid and your account is now being suspended. ` +
          `Settle the outstanding balance to restore access immediately.`,
        a.billingUrl,
        "Pay now to restore access",
      );
  }
}

function build(
  subject: string,
  greeting: string,
  body: string,
  url: string,
  cta: string,
): RenderedEmail {
  const text = `${greeting}\n\n${body}\n\n${cta}: ${url}\n`;
  const html =
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>${escapeHtml(body)}</p>` +
    `<p><a href="${escapeAttr(url)}" ` +
    `style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">` +
    `${escapeHtml(cta)}</a></p>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, "%22");
}
