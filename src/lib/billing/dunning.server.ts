// Dunning runner. Sends a single dunning step for an invoice, idempotently
// (the unique (invoice_id, template_key) index on dunning_emails prevents
// double-sends), and logs the outcome.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dunningTemplate } from "./dunning-templates";
import { sendEmail } from "./email.server";
import { formatMinor } from "./pricing";
import type { DunningStep } from "./state-machine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

function billingUrl(): string {
  const base = process.env.APP_BASE_URL ?? "";
  return `${base}/billing`;
}

export async function sendDunningStep(args: {
  companyId: string;
  invoiceId: string | null;
  step: DunningStep;
}): Promise<void> {
  const { companyId, invoiceId, step } = args;

  // Idempotency guard: skip if this step was already sent for this invoice.
  if (invoiceId) {
    const { data: existing } = await sb
      .from("dunning_emails")
      .select("id")
      .eq("invoice_id", invoiceId)
      .eq("template_key", step)
      .maybeSingle();
    if (existing) return;
  }

  // Gather context.
  const { data: company } = await sb
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();

  let invoiceRef = invoiceId ?? "your latest invoice";
  let amountFormatted = "";
  let recipient: string | null = null;

  if (invoiceId) {
    const { data: inv } = await sb
      .from("invoices")
      .select("ref, gross_amount_minor, currency")
      .eq("id", invoiceId)
      .maybeSingle();
    if (inv) {
      invoiceRef = inv.ref ?? invoiceRef;
      amountFormatted = formatMinor(inv.gross_amount_minor ?? 0, inv.currency ?? "GBP");
    }
  }

  // Recipient: the company's admin member email.
  const { data: admin } = await sb
    .from("company_members")
    .select("email")
    .eq("company_id", companyId)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  recipient = admin?.email ?? null;

  const rendered = dunningTemplate(step, {
    companyName: company?.name ?? "there",
    invoiceRef,
    amountFormatted: amountFormatted || "the outstanding amount",
    billingUrl: billingUrl(),
  });

  let status: "sent" | "failed" | "skipped" = "skipped";
  let providerMessageId: string | null = null;

  if (recipient) {
    const result = await sendEmail({
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    status = result.ok ? "sent" : "failed";
    providerMessageId = result.providerMessageId;
  }

  await sb.from("dunning_emails").insert({
    tenant_id: companyId,
    invoice_id: invoiceId,
    template_key: step,
    status,
    provider_message_id: providerMessageId,
  });
}
