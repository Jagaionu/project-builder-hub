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
import { computeProration, computeCancellationRefund } from "./proration";
import { buildPaymentHistory, type PaymentInvoiceRow } from "./payment-history";
import { createHash } from "node:crypto";
import { SUBSCRIPTION_AGREEMENT_VERSION, linkedPolicyVersions } from "../subscription-agreement";
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

// Tenant: record acceptance of the subscription agreement (clickwrap). Stores an
// append-only, hashed snapshot of exactly what was accepted.
export const recordAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        plan: PlanEnum,
        interval: IntervalEnum,
        agreementVersion: z.string().min(1),
        documentSnapshot: z.string().min(1),
        netMinor: z.number().int(),
        taxMinor: z.number().int(),
        feeMinor: z.number().int(),
        grossMinor: z.number().int(),
        currency: z.string().default("GBP"),
        deviceId: z.string().optional(),
        userAgent: z.string().optional(),
        personalGuarantee: z.boolean().optional(),
        guarantorName: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const companyId = await tenantForUser(context.userId);
    const { data: member } = await sb
      .from("company_members")
      .select("name, email, role")
      .eq("user_id", context.userId)
      .eq("company_id", companyId)
      .maybeSingle();
    const sha256 = createHash("sha256").update(data.documentSnapshot).digest("hex");
    const { data: row } = await sb
      .from("billing_agreements")
      .insert({
        tenant_id: companyId,
        user_id: context.userId,
        accepted_by_name: member?.name ?? null,
        accepted_by_email: member?.email ?? null,
        accepted_by_role: member?.role ?? null,
        agreement_version: data.agreementVersion,
        linked_policy_versions: linkedPolicyVersions(),
        document_snapshot: data.documentSnapshot,
        document_sha256: sha256,
        plan: data.plan,
        interval: data.interval,
        price_net_minor: data.netMinor,
        price_tax_minor: data.taxMinor,
        price_fee_minor: data.feeMinor,
        price_gross_minor: data.grossMinor,
        currency: data.currency,
        user_agent: data.userAgent ?? null,
        device_id: data.deviceId ?? null,
        personal_guarantee: data.personalGuarantee ?? false,
        guarantor_name: data.guarantorName ?? null,
      } as never)
      .select("id")
      .maybeSingle();
    return { ok: true, id: (row?.id as string) ?? null };
  });

// Tenant: whether the caller company has accepted the CURRENT agreement version.
export const getMyAgreementStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    const companyId = await tenantForUser(context.userId);
    const { data } = await sb
      .from("billing_agreements")
      .select("agreement_version, accepted_at")
      .eq("tenant_id", companyId)
      .eq("agreement_version", SUBSCRIPTION_AGREEMENT_VERSION)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      accepted: Boolean(data),
      currentVersion: SUBSCRIPTION_AGREEMENT_VERSION,
      acceptedAt: (data?.accepted_at as string) ?? null,
    };
  });

// Super-admin: list a company accepted agreements (for the admin panel).
export const getCompanyAgreements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { data: rows } = await sb
      .from("billing_agreements")
      .select(
        "id, accepted_by_name, accepted_by_email, accepted_by_role, accepted_at, agreement_version, document_snapshot, document_sha256, plan, interval, price_gross_minor, currency, ip, user_agent, device_id, personal_guarantee, guarantor_name",
      )
      .eq("tenant_id", data.companyId)
      .order("accepted_at", { ascending: false })
      .limit(50);
    return rows ?? [];
  });

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

// ── Super-admin: chronological payment history for one company ──
// Derived from settled invoices (paid = +gross, refunded = -gross). Naturally
// de-duplicated and needs no backfill. Super-admin only.
export const getCompanyPaymentHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { data: invoices } = await sb
      .from("invoices")
      .select(
        "id, ref, status, currency, net_amount_minor, tax_amount_minor, fee_amount_minor, gross_amount_minor, provider, plan, interval, payment_reference, paid_at, created_at",
      )
      .eq("tenant_id", data.companyId)
      .in("status", ["paid", "refunded"])
      .order("created_at", { ascending: false })
      .limit(500);
    return buildPaymentHistory((invoices ?? []) as PaymentInvoiceRow[]);
  });

// ── Super-admin: read/update the per-plan price book (plan_prices) ──
export const listPlanPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const { data } = await sb
      .from("plan_prices")
      .select("plan, interval, currency, net_amount_minor, active")
      .eq("currency", "GBP")
      .eq("active", true);
    return (data ?? []) as Array<{
      plan: string;
      interval: string;
      currency: string;
      net_amount_minor: number;
      active: boolean;
    }>;
  });

export const setPlanPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ plan: PlanEnum, interval: IntervalEnum, netMinor: z.number().int().min(0) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { data: existing } = await sb
      .from("plan_prices")
      .select("id")
      .eq("plan", data.plan)
      .eq("interval", data.interval)
      .eq("currency", "GBP")
      .eq("active", true)
      .maybeSingle();
    if (existing?.id) {
      await sb
        .from("plan_prices")
        .update({ net_amount_minor: data.netMinor, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await sb.from("plan_prices").insert({
        plan: data.plan,
        interval: data.interval,
        currency: "GBP",
        net_amount_minor: data.netMinor,
        active: true,
      });
    }
    return { ok: true };
  });

// Tenant: full price breakdown for a plan/interval/provider (for the acceptance
// screen and to snapshot the exact figures agreed to).
export const previewCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ plan: PlanEnum, interval: IntervalEnum, provider: ProviderEnum }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const companyId = await tenantForUser(context.userId);
    return buildBreakdown({
      companyId,
      plan: data.plan as PlanTier,
      interval: data.interval as BillingInterval,
      provider: data.provider as Provider,
    });
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

    // Belt-and-braces: a non-super-admin must have accepted the current
    // subscription agreement before any checkout can start.
    if (!sa) {
      const { data: agr } = await sb
        .from("billing_agreements")
        .select("id")
        .eq("tenant_id", companyId)
        .eq("agreement_version", SUBSCRIPTION_AGREEMENT_VERSION)
        .limit(1)
        .maybeSingle();
      if (!agr)
        throw new Error("AGREEMENT_REQUIRED: please accept the subscription agreement first");
    }

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

        // Reuse an existing OPEN invoice for the same plan/interval instead of
        // stacking a new draft every time the customer tries a different
        // provider. Keeps a single live invoice per plan period.
        const payRef =
          data.provider === "bank_transfer"
            ? "PAY-" + Date.now().toString(36).toUpperCase()
            : null;
        const invFields = {
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
          payment_reference: payRef,
        };
        const { data: existingOpen } = await sb
          .from("invoices")
          .select("id")
          .eq("tenant_id", companyId)
          .eq("status", "open")
          .eq("plan", data.plan)
          .eq("interval", data.interval)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        let invId: string | null = existingOpen?.id ?? null;
        if (invId) {
          await sb.from("invoices").update(invFields).eq("id", invId);
          await sb.from("invoice_line_items").delete().eq("invoice_id", invId);
        } else {
          const { data: inv } = await sb
            .from("invoices")
            .insert({ tenant_id: companyId, ...invFields })
            .select("id")
            .maybeSingle();
          invId = inv?.id ?? null;
        }
        // Collapse any other stale open invoices for this plan period to void.
        if (invId) {
          await sb
            .from("invoices")
            .update({ status: "void" })
            .eq("tenant_id", companyId)
            .eq("status", "open")
            .eq("plan", data.plan)
            .eq("interval", data.interval)
            .neq("id", invId);
        }
        if (invId) await insertBreakdownLineItems(invId, companyId!, data.plan, breakdown);

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
        return { redirectUrl: checkout.redirectUrl, invoiceId: invId, breakdown };
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
        const periodEnd = company?.current_period_end
          ? new Date(company.current_period_end)
          : new Date(Date.now() + 30 * 86400000);
        // Real current-period start: latest paid invoice, else one month before
        // the period end. Makes proration day-accurate (handles 28-31 day months).
        const { data: lastPaid } = await sb
          .from("invoices")
          .select("paid_at")
          .eq("tenant_id", data.companyId)
          .eq("status", "paid")
          .order("paid_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const periodStart = lastPaid?.paid_at
          ? new Date(lastPaid.paid_at)
          : new Date(periodEnd.getTime() - 30 * 86400000);
        const changeAt = new Date();
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
                periodStart,
                periodEnd,
                changeAt,
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
          "id, name, plan, subscription_status, subscription_ends_at, billing_provider, current_period_end, config",
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
    // Net monthly price the company is on: per-company override wins, else the
    // active plan_prices default. Lets the billing page show what they pay.
    const cfg = (company?.config ?? {}) as { priceMonthlyMinor?: number | null };
    let priceMonthlyMinor: number | null = cfg.priceMonthlyMinor ?? null;
    if (priceMonthlyMinor == null && company?.plan) {
      const { data: pp } = await sb
        .from("plan_prices")
        .select("net_amount_minor")
        .eq("plan", company.plan)
        .eq("interval", "monthly")
        .eq("currency", "GBP")
        .eq("active", true)
        .maybeSingle();
      priceMonthlyMinor = pp?.net_amount_minor ?? null;
    }
    return { company, invoices: invoices ?? [], methods: methods ?? [], priceMonthlyMinor };
  });

// ── Cancellation + refund ────────────────────────────────────
async function resolveCompanyForCaller(userId: string, companyId?: string): Promise<string> {
  const { data: sa } = await supabaseAdmin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (sa && companyId) return companyId;
  return tenantForUser(userId);
}

// Resolve the prorated cancellation refund from the latest paid invoice and the
// current period. Net + tax are refundable; the processing fee is not.
async function resolveCancellationRefund(companyId: string) {
  const { data: company } = await sb
    .from("companies")
    .select("plan, billing_provider, billing_customer_ref, current_period_end")
    .eq("id", companyId)
    .maybeSingle();
  const provider = (company?.billing_provider ?? "bank_transfer") as Provider;
  const { data: inv } = await sb
    .from("invoices")
    .select(
      "id, net_amount_minor, tax_amount_minor, gross_amount_minor, currency, plan, interval, paid_at, payment_reference",
    )
    .eq("tenant_id", companyId)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = {
    eligible: false,
    provider,
    customerRef: (company?.billing_customer_ref ?? null) as string | null,
    chargeRef: null as string | null,
    plan: (company?.plan ?? null) as string | null,
    interval: null as string | null,
    currency: "GBP",
    refundMinor: 0,
    netRefundMinor: 0,
    taxRefundMinor: 0,
    remainingDays: 0,
    totalDays: 0,
  };
  if (!inv?.paid_at) return base;

  const periodEnd = company?.current_period_end
    ? new Date(company.current_period_end)
    : new Date(new Date(inv.paid_at).getTime() + 30 * 86400000);
  const periodStart = new Date(inv.paid_at);
  const refundableMinor = (inv.net_amount_minor ?? 0) + (inv.tax_amount_minor ?? 0);
  const res = computeCancellationRefund({
    refundableMinor,
    periodStart,
    periodEnd,
    cancelAt: new Date(),
  });
  const netRefundMinor = Math.round((inv.net_amount_minor ?? 0) * res.remainingFraction);
  const taxRefundMinor = res.refundMinor - netRefundMinor;
  return {
    ...base,
    eligible: res.refundMinor > 0,
    chargeRef: (inv.payment_reference ?? null) as string | null,
    plan: (inv.plan ?? company?.plan ?? null) as string | null,
    interval: (inv.interval ?? null) as string | null,
    currency: (inv.currency ?? "GBP") as string,
    refundMinor: res.refundMinor,
    netRefundMinor,
    taxRefundMinor,
    remainingDays: res.remainingDays,
    totalDays: res.totalDays,
  };
}

// ── Tenant/super-admin: preview the refund due on cancellation ──
export const previewCancellation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ companyId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const companyId = await resolveCompanyForCaller(context.userId, data.companyId);
    const r = await resolveCancellationRefund(companyId);
    return {
      eligible: r.eligible,
      refundMinor: r.refundMinor,
      currency: r.currency,
      remainingDays: r.remainingDays,
      totalDays: r.totalDays,
      provider: r.provider,
    };
  });

// ── Tenant/super-admin: cancel subscription + pro-rata refund ──
export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyId: z.string().uuid().optional(),
        reason: z.string().trim().max(500).optional(),
        idempotencyKey: z.string().min(8),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const companyId = await resolveCompanyForCaller(context.userId, data.companyId);
    return withIdempotency(
      supabaseIdempotencyStore,
      { key: data.idempotencyKey, operation: "cancel_subscription", companyId },
      async () => {
        const r = await resolveCancellationRefund(companyId);
        let refundStatus: "pending" | "succeeded" | "failed" | "none" = "none";
        let refundRef: string | null = null;

        if (r.eligible && r.refundMinor > 0) {
          if (r.provider !== "bank_transfer" && r.customerRef && r.chargeRef) {
            try {
              const rr = await getProvider(r.provider).refund({
                customerRef: r.customerRef,
                chargeRef: r.chargeRef,
                amountMinor: r.refundMinor,
                reason: data.reason ?? "cancellation",
              });
              refundStatus = rr.status;
              refundRef = rr.refundProviderRef || null;
            } catch (e) {
              await recordPaymentEvent({
                tenantId: companyId,
                provider: r.provider,
                eventType: "cancel.refund.provider_error",
                actor: context.userId,
                data: { error: String(e), refundMinor: r.refundMinor },
              });
              throw new Error("Refund failed at the payment provider; cancellation aborted");
            }
          } else {
            // Bank transfer (or no charge ref): a super admin pays the refund out.
            refundStatus = "pending";
          }

          const { data: credit } = await sb
            .from("invoices")
            .insert({
              tenant_id: companyId,
              provider: r.provider,
              status: "refunded",
              currency: r.currency,
              net_amount_minor: -r.netRefundMinor,
              tax_amount_minor: -r.taxRefundMinor,
              fee_amount_minor: 0,
              gross_amount_minor: -r.refundMinor,
              plan: r.plan,
              interval: r.interval,
              payment_reference: refundRef,
            })
            .select("id")
            .maybeSingle();
          if (credit?.id) {
            await sb.from("invoice_line_items").insert({
              invoice_id: credit.id,
              tenant_id: companyId,
              kind: "refund",
              description: "Pro-rata refund for unused period (" + r.remainingDays + " days)",
              quantity: 1,
              amount_minor: -r.refundMinor,
            });
          }
        }

        await processBillingEvent(companyId, { kind: "subscription_cancelled" }, {});
        await sb
          .from("companies")
          .update({
            subscription_status: "cancelled",
            subscription_ends_at: new Date().toISOString(),
          })
          .eq("id", companyId);
        await recordPaymentEvent({
          tenantId: companyId,
          provider: r.provider,
          eventType: "subscription.cancelled",
          actor: context.userId,
          data: {
            refundMinor: r.refundMinor,
            remainingDays: r.remainingDays,
            refundStatus,
            reason: data.reason ?? null,
          },
        });
        return { ok: true, refundMinor: r.refundMinor, remainingDays: r.remainingDays, refundStatus };
      },
    );
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
