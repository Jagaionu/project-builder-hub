# Billing & Payments — Setup, Operations & Compliance

This document covers how to turn on the payments system (GoCardless, bank
transfer, Stripe Billing), how it works, and the legal/compliance checklist.

> ⚠️ **Not legal advice.** The compliance section lists the standard
> requirements for a UK B2B SaaS taking payments. Have a solicitor review your
> terms, privacy policy, and fee disclosure before going live.

---

## 1. Architecture overview

One provider-agnostic core; three providers behind a single interface.

```
src/lib/billing/
  types.ts                  shared types (money = integer minor units / pence)
  pricing.ts                pure net -> tax -> fee engine (+ tests)
  proration.ts              pure mid-term proration (+ tests)
  state-machine.ts          pure entitlement/dunning state machine (+ tests)
  plan-entitlements.ts      plan -> modules/limits/branding (+ tests)
  dunning-templates.ts      pure email copy (+ tests)
  idempotency.ts            reserve-first dedupe wrapper (+ tests)
  provider.ts               PaymentProvider interface
  registry.ts               provider lookup
  providers/                stripe.ts | gocardless.ts | bank-transfer.ts
  pricing-loader.server.ts  builds breakdown from DB price book + tax profile
  idempotency.server.ts     Supabase-backed idempotency store
  orchestrator.server.ts    applies transitions to DB; processes webhook events
  email.server.ts           sends via configured provider (Resend/Postmark)
  dunning.server.ts         idempotent dunning step sender
  webhook-ingest.server.ts  two-stage (dead-letter then verify+process)
  billing-sweep.server.ts   trial expiry + webhook backlog alert
  billing.functions.ts      createServerFn actions (admin + tenant)
```

Money is **always** integer minor units (pence). `gross = net + tax + fee`.

## 2. One-time setup

1. **Apply migrations** to Supabase (in order):
   - `20260610100000_36_billing_foundation.sql`
   - `20260610110000_37_email_provider_config.sql`
   ```bash
   supabase db push        # or run via the SQL editor / your migration flow
   ```
2. **Regenerate DB types** so the new tables are strongly typed:
   ```bash
   npm run db:types
   ```
   (Until this is run, server/UI code uses the project's existing
   `supabaseAdmin as unknown as { from }` cast pattern — already in place.)
3. **Set environment variables** (see `.env.example`): `APP_BASE_URL`,
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOCARDLESS_ACCESS_TOKEN`,
   `GOCARDLESS_ENVIRONMENT`, `GOCARDLESS_WEBHOOK_SECRET`.
4. **Configure webhooks** in each provider dashboard:
   - Stripe → `POST {APP_BASE_URL}/api/public/webhooks/stripe`
     (events: `invoice.paid`, `invoice.payment_failed`,
     `customer.subscription.deleted`)
   - GoCardless → `POST {APP_BASE_URL}/api/public/webhooks/gocardless`
5. **Set the email provider** from the admin dashboard:
   Super Admin → **Billing** tab → **Email provider** (Resend or Postmark API
   key, from-address). Powers dunning emails.
6. **Schedule the billing sweep** (pg_cron, like the existing shift-rollover):
   `POST {APP_BASE_URL}/api/public/cron/billing-sweep` daily, with the Supabase
   anon key in the `apikey` header.
7. **Review the price book** (`plan_prices`) and **fee schedule**
   (`provider_fee_config`) — seeded with placeholder GBP values; edit to match
   your real prices and your providers' contracted fees.

## 3. How pricing works (fee-inclusive)

`net -> tax -> fee`:

1. `net` from `plan_prices` (pence).
2. `tax` = VAT on net. UK = 20%; EU with a valid VAT number = reverse charge
   (0%); outside UK/EU = zero-rated. (`tax_calculation_method`.)
3. `fee` = processor fee **grossed up** over the tax-inclusive amount so the
   customer covers it: `gross = ceil((amount + fixed) / (1 - pct))`, capped if a
   cap is set.

Example (reverse-charge or pre-VAT, £600 net via GoCardless 1% + £0.20 capped
£4.00): fee = £4.00 → **£604.00 total**. All four numbers
(net/tax/fee/gross) are stored on every invoice and shown as line items.

## 4. Automations (driven by the admin "level")

The pure state machine maps events to status + actions:

| Trigger                                                       | Result                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Super admin changes plan/level                                | new entitlements (modules/limits) applied; prorated invoice if mid-term |
| Payment succeeded / mandate active / bank transfer reconciled | `active`, period extended                                               |
| Payment failed                                                | dunning ladder day1 → day3 → suspended_warning; suspend after grace     |
| Subscription cancelled                                        | `cancelled`                                                             |
| Trial expired (sweep)                                         | `suspended`                                                             |

Suspension is enforced automatically by existing RLS
(`current_subscription_status() IN ('active','trial')`).

## 5. Operational robustness

- **Idempotency:** every mutating billing server function takes an
  `idempotencyKey`; duplicates return the stored result (no double charge).
- **Webhook dead-letter + replay:** raw events are persisted to
  `webhook_incoming` before processing; failures keep `processed_at = NULL`.
  Replay from Super Admin → Billing → **Webhook log**. The sweep alerts if more
  than 5 events are unprocessed for over an hour.
- **Bank-transfer reconciliation is audited:** marking an invoice paid requires
  a `bank_statement_reference` and matched amount, recorded in
  `billing_reconciliation_log` (who/when/proof) before the invoice flips to
  paid.

## 6. Legal / compliance checklist (review with a solicitor)

- [ ] **Terms of Service** + **Subscription/Billing terms** (renewal,
      cancellation, refunds, price changes, fee disclosure).
- [ ] **Privacy Policy / GDPR**; sign **DPAs** with Stripe and GoCardless
      (both are processors / sub-processors).
- [ ] **Direct Debit Guarantee** wording shown during the GoCardless mandate
      flow, plus advance notice of charges.
- [ ] **SCA / PSD2** — handled by Stripe Checkout & GoCardless hosted flows.
- [ ] **VAT invoicing** — compliant invoices with VAT number and breakdown if
      VAT-registered (line items already split net/VAT/fee).
- [ ] **Refund & cancellation policy**; chargeback/dispute process.
- [ ] **Fee disclosure** before payment. The billing page states fees are
      included and that the customer contracts as a **business**.
- [ ] **Surcharge legality:** passing card/Direct-Debit fees to _consumers_ is
      illegal in the UK/EU; it is permitted for **business customers**. Confirm
      every tenant contracts as a business. (Customers here are companies.)
- [ ] Merchant agreements with Stripe and GoCardless accepted.

## 7. What needs live credentials to validate end-to-end

The pure logic (pricing, proration, state machine, entitlements, dunning copy,
idempotency) is unit-tested (`npm test`). The following require your
environment to exercise for real:

- Stripe / GoCardless **sandbox keys** — to run a real checkout/mandate and
  receive signed webhooks.
- A **Supabase** instance with migrations applied + `npm run db:types`.
- An **email provider** API key (set in the admin dashboard) to send dunning.
