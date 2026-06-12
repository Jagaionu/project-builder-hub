// Billing server functions. Super-admin actions are guarded by assertSuperAdmin;
// the customer self-service function is scoped to the caller's own tenant.
// All mutating provider operations run through withIdempotency.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProvider } from "./registry";
import { buildBreakdown } from "./pricing-loader.server";
import { withIdempotency } from "./idempotency";
import { supabaseIdempotencyStore } from "./idempotency.server";
import {
  processBillingEvent,
  recordPaymentEvent,
  handleNormalisedEvent,
} from "./orchestrator.server";
import { computeProration } from "./proration";
import type { BillingInterval, PlanTier, Provider } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as unknown as { from: (t: string) => any };

async function assertSuperAdmin(userId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Forbidden: super admin only");
}

async function tenantForUser(userId: string): Promise<string> {
  const { data } = await sb
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("No company for user");
  return data.company_id as string;
}

const PlanEnum = z.enum(["starter", "pro", "enterprise"]);
const IntervalEnum = z.enum(["monthly", "annual"]);
const ProviderEnum = z.enum(["stripe", "gocardless", "bank_transfer"]);

// ── Super-admin: billing overview for one company ────────────
export const getCompanyBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const [{ data: company }, { data: invoices }, { data: methods }] = await Promise.all([
      sb
        .from("companies")
        .select(
          "id, name, plan, subscription_status, subscription_ends_at, billing_provider, billing_customer_ref, country_code, vat_number, current_period_end",
        )
        .eq("id", data.companyId)
        .maybeSingle(),
      sb
        .from("invoices")
        .select(
          "id, ref, status, currency, net_amount_minor, tax_amount_minor, fee_amount_minor, gross_amount_minor, tax_rate_bp, tax_calculation_method, provider, plan, interval, due_date, paid_at, payment_reference, created_at",
        )
        .eq("tenant_id", data.companyId)
        .order("created_at", { ascending: false })
        .limit(100),
      sb
        .from("payment_methods")
        .select("id, provider, kind, brand, bank_name, last4, status, is_default")
        .eq("tenant_id", data.companyId),
    ]);
    return { company, invoices: invoices ?? [], methods: methods ?? [] };
  });

// ── Super-admin: set the billing provider for a company ──────
export const setCompanyProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyId: z.string().uuid(),
        provider: ProviderEnum,
        idempotencyKey: z.string().min(8),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    return withIdempotency(
      supabaseIdempotencyStore,
      { key: data.idempotencyKey, operation: "set_provider", companyId: data.companyId },
      async () => {
        const { data: company } = await sb
          .from("companies")
          .select("name, billing_customer_ref, country_code, vat_number")
          .eq("id", data.companyId)
          .maybeSingle();
        const { data: admin } = await sb
          .from("company_members")
          .select("email")
          .eq("company_id", data.companyId)
          .eq("role", "admin")
          .limit(1)
          .maybeSingle();
        const provider = getProvider(data.provider as Provider);
        const customerRef = await provider.createCustomer({
          companyId: data.companyId,
          name: company?.name ?? "Company",
          email: admin?.email ?? "billing@example.com",
          countryCode: company?.country_code ?? "GB",
          vatNumber: company?.vat_number ?? null,
          providerRef: company?.billing_customer_ref ?? null,
        });
        await sb
          .from("companies")
          .update({ billing_provider: data.provider, billing_customer_ref: customerRef })
          .eq("id", data.companyId);
        await recordPaymentEvent({
          tenantId: data.companyId,
          provider: data.provider,
          eventType: "admin.set_provider",
          actor: context.userId,
          data: { customerRef },
        });
        return { customerRef };
      },
    );
  });

// ── Super-admin / tenant: start a hosted checkout for a plan ──
export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyId: z.string().uuid().optional(),
        plan: PlanEnum,
        interval: IntervalEnum,
        provider: ProviderEnum,
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
        idempotencyKey: z.string().min(8),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Resolve target company: super admins may pass any; others use their own.
    let companyId = data.companyId;
    const { data: sa } = await supabaseAdmin
      .from("super_admins")
      .select("user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!sa) companyId = await tenantForUser(context.userId);
    if (!companyId) throw new Error("companyId required");

    return withIdempotency(
      supabaseIdempotencyStore,
      { key: data.idempotencyKey, operation: "checkout", companyId },
      async () => {
        const breakdown = await buildBreakdown({
          companyId: companyId!,
          plan: data.plan,
          interval: data.interval,
          provider: data.provider as Provider,
        });
        const { data: company } = await sb
          .from("companies")
          .select("name, billing_customer_ref, country_code, vat_number")
          .eq("id", companyId)
          .maybeSingle();
        const { data: admin } = await sb
          .from("company_members")
          .select("email")
          .eq("company_id", companyId)
          .eq("role", "admin")
          .limit(1)
          .maybeSingle();
        const provider = getProvider(data.provider as Provider);

        // Draft invoice capturing the full breakdown + line items.
        const { data: inv } = await sb
          .from("invoices")
          .insert({
            tenant_id: companyId,
            provider: data.provider,
            status: "open",
            currency: breakdown.currency,
            net_amount_minor: breakdown.netMinor,
            tax_amount_minor: breakdown.taxMinor,
            fee_amount_minor: breakdown.feeMinor,
            gross_amount_minor: breakdown.grossMinor,
            tax_rate_bp: breakdown.taxRateBp,
            tax_calculation_method: breakdown.taxMethod,
            plan: data.plan,
            interval: data.interval,
            payment_reference:
              data.provider === "bank_transfer"
                ? `PAY-${Date.now().toString(36).toUpperCase()}`
                : null,
          })
          .select("id")
          .maybeSingle();
        if (inv?.id) await insertBreakdownLineItems(inv.id, companyId!, data.plan, breakdown);

        const checkout = await provider.createCheckout({
          customer: {
            companyId: companyId!,
            name: company?.name ?? "Company",
            email: admin?.email ?? "billing@example.com",
            countryCode: company?.country_code ?? "GB",
            vatNumber: company?.vat_number ?? null,
            providerRef: company?.billing_customer_ref ?? null,
          },
          plan: data.plan,
          interval: data.interval,
          breakdown,
          successUrl: data.successUrl,
          cancelUrl: data.cancelUrl,
        });
        return { redirectUrl: checkout.redirectUrl, invoiceId: inv?.id ?? null, breakdown };
      },
    );
  });

// ── Super-admin: change a company's plan (with proration) ─────
export const changeCompanyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyId: z.string().uuid(),
        toPlan: PlanEnum,
        interval: IntervalEnum,
        behavior: z.enum(["immediate_charge", "immediate_credit", "at_period_end"]),
        idempotencyKey: z.string().min(8),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    return withIdempotency(
      supabaseIdempotencyStore,
      { key: data.idempotencyKey, operation: "change_plan", companyId: data.companyId },
      async () => {
        const { data: company } = await sb
          .from("companies")
          .select(
            "plan, billing_provider, billing_customer_ref, subscription_ends_at, current_period_end",
          )
          .eq("id", data.companyId)
          .maybeSingle();
        const fromPlan = (company?.plan ?? "starter") as PlanTier;
        const provider = (company?.billing_provider ?? "bank_transfer") as Provider;

        // Compute proration on NET prices for the remaining period.
        const oldNet = await netFor(fromPlan, data.interval);
        const newNet = await netFor(data.toPlan, data.interval);
        const periodStart = new Date();
        const periodEnd = company?.current_period_end
          ? new Date(company.current_period_end)
          : new Date(Date.now() + 30 * 86400000);
        const proration =
          data.behavior === "at_period_end"
            ? {
                amountMinor: 0,
                isCredit: false,
                effective: "at_period_end" as const,
                remainingFraction: 0,
              }
            : computeProration({
                oldNetMinor: oldNet,
                newNetMinor: newNet,
                periodStart: new Date(periodStart.getTime() - 15 * 86400000),
                periodEnd,
                changeAt: periodStart,
                behavior: data.behavior,
              });

        // Issue a proration invoice when there's an immediate net change.
        let invoiceId: string | null = null;
        if (proration.amountMinor !== 0) {
          const breakdown = await buildBreakdown({
            companyId: data.companyId,
            plan: data.toPlan,
            interval: data.interval,
            provider,
            netMinorOverride: Math.abs(proration.amountMinor),
          });
          const { data: inv } = await sb
            .from("invoices")
            .insert({
              tenant_id: data.companyId,
              provider,
              status: proration.isCredit ? "void" : "open",
              currency: "GBP",
              net_amount_minor: breakdown.netMinor,
              tax_amount_minor: breakdown.taxMinor,
              fee_amount_minor: breakdown.feeMinor,
              gross_amount_minor: breakdown.grossMinor,
              tax_rate_bp: breakdown.taxRateBp,
              tax_calculation_method: breakdown.taxMethod,
              plan: data.toPlan,
              interval: data.interval,
            })
            .select("id")
            .maybeSingle();
          invoiceId = inv?.id ?? null;
          if (invoiceId) {
            await sb.from("invoice_line_items").insert({
              invoice_id: invoiceId,
              tenant_id: data.companyId,
              kind: "proration",
              description: `Proration: ${fromPlan} -> ${data.toPlan}`,
              quantity: 1,
              amount_minor: proration.amountMinor,
            });
          }
          // Tell the provider to apply the change (where supported).
          if (provider !== "bank_transfer") {
            try {
              await getProvider(provider).changePlan({
                customerRef: company?.billing_customer_ref ?? "",
                fromPlan,
                toPlan: data.toPlan,
                interval: data.interval,
                behavior: data.behavior,
                breakdown,
              });
            } catch (e) {
              await recordPaymentEvent({
                tenantId: data.companyId,
                provider,
                eventType: "admin.change_plan.provider_error",
                actor: context.userId,
                data: { error: String(e) },
              });
            }
          }
        }

        // Apply entitlements via the state machine.
        await processBillingEvent(
          data.companyId,
          { kind: "plan_changed", newPlan: data.toPlan },
          { invoiceId, provider },
        );
        await recordPaymentEvent({
          tenantId: data.companyId,
          invoiceId,
          provider,
          eventType: "admin.change_plan",
          actor: context.userId,
          data: { fromPlan, toPlan: data.toPlan, proration },
        });
        return { invoiceId, proration };
      },
    );
  });

// ── Super-admin: reconcile a bank transfer (audited) ──────────
export const reconcileBankTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        invoiceId: z.string().uuid(),
        bankStatementReference: z.string().trim().min(1).max(255),
        matchedAmountMinor: z.number().int().nonnegative(),
        proofAttachmentUrl: z.string().url().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { data: inv } = await sb
      .from("invoices")
      .select("id, tenant_id, gross_amount_minor, status")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (!inv) throw new Error("Invoice not found");
    if (inv.status === "paid") throw new Error("Invoice already paid");

    // Audit record is mandatory and written BEFORE marking paid.
    await sb.from("billing_reconciliation_log").insert({
      tenant_id: inv.tenant_id,
      invoice_id: inv.id,
      admin_user_id: context.userId,
      matched_amount_minor: data.matchedAmountMinor,
      bank_statement_reference: data.bankStatementReference,
      proof_attachment_url: data.proofAttachmentUrl ?? null,
    });
    await sb
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", inv.id);

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await processBillingEvent(
      inv.tenant_id,
      { kind: "bank_transfer_reconciled", periodEnd: periodEnd.toISOString() },
      { invoiceId: inv.id, provider: "bank_transfer" },
    );
    await recordPaymentEvent({
      tenantId: inv.tenant_id,
      invoiceId: inv.id,
      provider: "bank_transfer",
      eventType: "admin.reconcile_bank_transfer",
      actor: context.userId,
      data: { ref: data.bankStatementReference, matched: data.matchedAmountMinor },
    });
    return { ok: true };
  });

// ── Super-admin: email provider config ───────────────────────
export const saveEmailProviderConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        provider: z.enum(["resend", "postmark", "ses"]),
        apiKey: z.string().min(1).max(500).optional(),
        fromEmail: z.string().email(),
        fromName: z.string().max(120).optional(),
        replyTo: z.string().email().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    // Deactivate any existing active config, then upsert the new active one.
    await sb.from("email_provider_config").update({ active: false }).eq("active", true);
    const row: Record<string, unknown> = {
      provider: data.provider,
      from_email: data.fromEmail,
      from_name: data.fromName ?? null,
      reply_to: data.replyTo ?? null,
      active: true,
    };
    if (data.apiKey) row.api_key = data.apiKey;
    await sb.from("email_provider_config").insert(row);
    await recordPaymentEvent({
      tenantId: null,
      eventType: "admin.email_config_saved",
      actor: context.userId,
      data: { provider: data.provider },
    });
    return { ok: true };
  });

export const getEmailProviderConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const { data } = await sb
      .from("email_provider_config")
      .select("provider, from_email, from_name, reply_to, api_key, active")
      .eq("active", true)
      .maybeSingle();
    if (!data) return { configured: false as const };
    return {
      configured: true as const,
      provider: data.provider,
      fromEmail: data.from_email,
      fromName: data.from_name,
      replyTo: data.reply_to,
      apiKeySet: Boolean(data.api_key), // never return the key itself
    };
  });

// ── Super-admin: webhook replay + monitoring ─────────────────
export const listWebhookEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ onlyPending: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    let q = sb
      .from("webhook_incoming")
      .select("id, provider, event_id, received_at, processed_at, attempts, error")
      .order("received_at", { ascending: false })
      .limit(100);
    if (data.onlyPending) q = q.is("processed_at", null);
    const { data: rows } = await q;
    return rows ?? [];
  });

export const replayWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { data: row } = await sb
      .from("webhook_incoming")
      .select("id, provider, raw_body, headers")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Webhook event not found");
    const provider = getProvider(row.provider as Provider);
    try {
      const ev = await provider.parseWebhook(
        row.raw_body,
        (row.headers ?? {}) as Record<string, string>,
      );
      await handleNormalisedEvent(ev);
      await sb
        .from("webhook_incoming")
        .update({ processed_at: new Date().toISOString(), error: null })
        .eq("id", row.id);
      return { ok: true };
    } catch (e) {
      await sb
        .from("webhook_incoming")
        .update({ attempts: ((row as { attempts?: number }).attempts ?? 0) + 1, error: String(e) })
        .eq("id", row.id);
      throw e;
    }
  });

// ── Tenant self-service: my billing summary ──────────────────
export const getMyBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    const companyId = await tenantForUser(context.userId);
    const [{ data: company }, { data: invoices }, { data: methods }] = await Promise.all([
      sb
        .from("companies")
        .select(
          "id, name, plan, subscription_status, subscription_ends_at, billing_provider, current_period_end",
        )
        .eq("id", companyId)
        .maybeSingle(),
      sb
        .from("invoices")
        .select(
          "id, ref, status, currency, net_amount_minor, tax_amount_minor, fee_amount_minor, gross_amount_minor, plan, interval, due_date, paid_at, created_at",
        )
        .eq("tenant_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50),
      sb
        .from("payment_methods")
        .select("id, provider, kind, brand, bank_name, last4, status, is_default")
        .eq("tenant_id", companyId),
    ]);
    return { company, invoices: invoices ?? [], methods: methods ?? [] };
  });

// ── helpers ──────────────────────────────────────────────────
async function netFor(plan: PlanTier, interval: BillingInterval): Promise<number> {
  const { data } = await sb
    .from("plan_prices")
    .select("net_amount_minor")
    .eq("plan", plan)
    .eq("interval", interval)
    .eq("currency", "GBP")
    .eq("active", true)
    .maybeSingle();
  return (data?.net_amount_minor as number) ?? 0;
}

async function insertBreakdownLineItems(
  invoiceId: string,
  tenantId: string,
  plan: PlanTier,
  b: { netMinor: number; taxMinor: number; feeMinor: number; taxMethod: string },
): Promise<void> {
  const items: Array<Record<string, unknown>> = [
    {
      invoice_id: invoiceId,
      tenant_id: tenantId,
      kind: "subscription",
      description: `${plan} plan`,
      quantity: 1,
      amount_minor: b.netMinor,
    },
  ];
  if (b.taxMinor > 0)
    items.push({
      invoice_id: invoiceId,
      tenant_id: tenantId,
      kind: "tax",
      description: "VAT (20%)",
      quantity: 1,
      amount_minor: b.taxMinor,
    });
  if (b.feeMinor > 0)
    items.push({
      invoice_id: invoiceId,
      tenant_id: tenantId,
      kind: "fee",
      description: "Processing fee",
      quantity: 1,
      amount_minor: b.feeMinor,
    });
  await sb.from("invoice_line_items").insert(items);
}
