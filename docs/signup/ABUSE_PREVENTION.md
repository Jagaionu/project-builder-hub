# Trial-Abuse Prevention — Operations Guide

Layered, identity-first protection for self-serve trials. Designed to be very
hard to abuse while staying frictionless for genuine UK carriers. **Everything
tunable lives in the database (`fraud_settings`) and is editable from the
super-admin dashboard with no code change and no redeploy.**

Admin dashboard: **Admin → Trust & Safety**.

---

## 1. Required environment variables

| Variable | Purpose | If unset |
|---|---|---|
| `COMPANIES_HOUSE_API_KEY` | Companies House Public Data API (free; register at developer.company-information.service.gov.uk). Basic-auth, key as username. | CH search returns nothing; every signup falls back to **manual verification** (routed to review). |
| `APP_BASE_URL` | Base URL for the email confirmation link redirect. | Confirmation link redirect may be relative. |
| `VITE_ONBOARDING_URL` | Booking link for the post-signup 15-minute onboarding call. | Onboarding CTA is hidden. |
| `VITE_CONTACT_EMAIL` | Address for the returning-customer "Contact us" path. | Defaults to `hello@theprimeroute.co.uk`. |
| `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` | `apikey` guard for the cron endpoints. | Cron returns 503. |

The **email provider** must also be configured (Admin → Billing → Email
provider). Without it, signup cannot send the confirmation link and will error
by design — no unconfirmable accounts are created.

## 2. Database migrations (run in Supabase Studio, in order)

- `50_trial_abuse_prevention` — company identity + verification_status,
  `trial_signups` (permanent ledger), `signup_events`, `signup_decision_log`,
  `trial_risk_events`, seeded `email_domain_signals`, `fraud_settings`.
- `51_companies_house_cache` — 24h CH response cache (server-only).
- `52_behaviour_thresholds` — configurable behavioural thresholds on
  `fraud_settings`.

## 3. Scheduled jobs (pg_cron)

```sql
-- Purge unconfirmed accounts (>24h) and abandoned trials (>21 days), daily.
select cron.schedule('signup-cleanup', '0 3 * * *', $$
  select net.http_post(
    url := 'https://theprimeroute.co.uk/api/public/cron/signup-cleanup',
    headers := jsonb_build_object('apikey', '<SUPABASE_ANON_KEY>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb);
$$);

-- Trusted-status promotion + behavioural risk sweep, hourly.
select cron.schedule('fraud-sweep', '15 * * * *', $$
  select net.http_post(
    url := 'https://theprimeroute.co.uk/api/public/cron/fraud-sweep',
    headers := jsonb_build_object('apikey', '<SUPABASE_ANON_KEY>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb);
$$);
```

## 4. How a signup is decided

1. **Rate limit** (per IP + device, `rate_limit_*`). Excess → soft cooldown.
2. **Companies House re-validation** of the selected company number. Confirmed →
   `companies_house`; otherwise → `manual`.
3. **Duplicate / cooldown**: a *verified* company number used within
   `cooldown_months` is **hard-blocked** (returning-customer message) — outside
   scoring.
4. **Two scores**: *Identity Trust* (CH / manual / business email / director)
   and *Fraud Risk* (same device / same IP / disposable email / repeated failed
   signups).
5. **Decision**: `trusted` companies skip checks; a CH-verified signup with
   trust ≥ `trust_min` and risk < `risk_threshold` becomes an **active trial**;
   everything else is created **inactive** (`pending_review`) and sent to the
   review queue.
6. The account is always created immediately (email + password are theirs) but
   stays inactive until approved. The **reason is never shown** to the user —
   they see a generic "we are verifying your details" screen.

Every step is recorded in `trial_signups` (permanent), `signup_events`, and
`signup_decision_log`.

## 5. Tuning (Admin → Trust & Safety → Detection settings)

- **Thresholds**: `risk_threshold` (default 50), `trust_min` (100),
  `cooldown_months` (24).
- **Rate limit**: `rate_limit_max_attempts` (10) / `rate_limit_window_minutes` (10).
- **Identity trust weights**: CH 100, manual 40, business email 20, director 10.
- **Fraud risk weights**: device 30, IP 20, free email 15, disposable 40,
  repeated failed signups 30.
- **Trusted status**: `trusted_min_paid_invoices` (3), `trusted_min_active_days` (60).
- **Behaviour (active trials, 24h)**: max devices 5, max countries 3, max jobs
  300, max drivers 30.

**Observe real data for 2–4 weeks before major tuning.** The defaults are a
reasonable starting point; real signups will show what matters.

## 6. Review runbook (Admin → Trust & Safety)

- **Pending review**: shows the company, contact email, verification method, the
  internal trust/risk scores, the reasons, and the full decision log.
  - **Approve trial** → verified + a fresh 7-day trial (access enabled).
  - **Reject** → blocked + cancelled.
- **Recently blocked** (returning within cooldown):
  - **Grant new trial** → clears the cooldown so the business can sign up again.
    No manual DB edits.

## 7. Metrics

Trials today, pending review, duplicate/blocked, approved, **false positives**
(flagged then approved), **Companies House verification rate**, and **average
review time**.

## 8. Roadmap (not built)

- **Phase 2 — card-on-file for flagged signups only.** If abuse rises, require a
  payment method (Stripe/GoCardless, already integrated) *only* when a signup is
  flagged, instead of for everyone. Most honest customers never see it.
- **Phase 3 — lead qualification.** VAT number validation, LinkedIn company
  page, fleet size, number of planners. These tailor onboarding rather than act
  as security controls.

## 9. Notes

- The `trial_signups` ledger is **permanent** — never delete it, even when an
  account is removed. It is the fraud history the duplicate/cooldown check and
  the behavioural sweep rely on.
- Legal/marketing copy in the signup and landing flows is a mechanism only; the
  actual wording should be reviewed by a UK solicitor before go-live.
