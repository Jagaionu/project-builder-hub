# Super-Admin Security — Operations Runbook

Hardening for the platform super-admin account(s): mandatory TOTP MFA, one-time
recovery codes, login notifications, session management, app-level login
rate-limiting, and an immutable audit log.

Admin surface: **Admin → Security** tab.

---

## ⚠️ Rollout order (read before deploying)

MFA is enforced in `admin.tsx` — a super admin with no verified TOTP factor is
redirected to `/mfa` to enrol. **If the Supabase MFA feature is not enabled when
this deploys, enrolment fails and the super admin cannot reach `/admin`.**

Do it in this order:

1. **Run the migrations** (Supabase SQL editor): `53_super_admin_security`,
   `54_login_attempts`.
2. **Enable MFA (TOTP)** in Supabase → Authentication → **Providers / Sign In →
   Multi-Factor Auth → enable TOTP**.
3. **Confirm the email provider works** (needed for login notifications) — Admin
   → Billing → Email provider.
4. **Then redeploy** the app. On the next super-admin login you'll be sent to
   `/mfa` to enrol (QR + verify) and shown 10 recovery codes once.

If you ever get locked out, see **Break-glass** below.

## Supabase settings (you)

- **Enable TOTP MFA** (required — see rollout).
- **Leaked-password protection**: Authentication → Policies → enable.
- **Password reset link expiry**: keep short (default is fine).
- **Site URL / Redirect URLs**: `https://theprimeroute.co.uk` (also fixes email links).
- **Strong password** on every super admin (20–30 char random, password manager).
- **Real, monitored email** per super admin (e.g. `security@theprimeroute.co.uk`) —
  `super_admins` keys on `user_id`, so changing the email keeps the role.

## What's enforced / available

- **Mandatory MFA (no bypass):** `/admin` requires a verified TOTP factor **and**
  an AAL2 session. Otherwise → `/mfa` (enrol or challenge).
- **Recovery codes:** 10 one-time codes, hashed (`super_admin_recovery_codes`),
  shown once at enrolment. On the challenge screen, "Lost your device? Use a
  recovery code" consumes one and **removes your TOTP factors** so you can enrol
  a fresh authenticator. Regenerate anytime in Admin → Security (invalidates the
  previous set).
- **Login notifications:** every super-admin sign-in emails the account (time,
  device, IP, approximate location + "wasn't you? reset now").
- **Session management:** Admin → Security shows recent sign-ins and a **Log out
  all other sessions** button.
- **Login rate limiting:** `preLoginCheck` throttles by IP/email using the
  configurable `fraud_settings` window/threshold (defence-in-depth over Supabase).
- **Immutable audit log:** `super_admin_audit` (RLS: super admins read-only, no
  update/delete; service role writes). Viewable in Admin → Security.

### Audited actions
- **auth:** super_admin_login, recovery_codes_regenerated, recovery_code_used.
- **security:** fraud_settings_changed.
- **administration:** signup_approved, signup_rejected, trial_granted.
- **billing:** plan_price_changed, plan_definition_changed, billing_provider_changed, plan_changed.
- **data:** company_deleted.

(Extend `recordAudit(...)` calls as new privileged actions are added — e.g. super
admin add/remove, user suspend/unsuspend, impersonation if ever built.)

## Break-glass (emergency recovery account)

Create a **second super admin** that is dormant and used only for disaster
recovery (lost phone + lost recovery codes + unavailable password manager):

1. Create a dedicated auth user (e.g. `breakglass@theprimeroute.co.uk`) with an
   extremely long random password stored **offline** (printed / sealed).
2. Add its `user_id` to `super_admins`.
3. On first login it will be forced through MFA enrolment on **its own**
   authenticator device; store **its** recovery codes offline too.
4. Never use it for day-to-day work. Its login still emails a notification, so
   any use is visible.

To recover a locked-out primary admin, sign in with break-glass and (via
Supabase dashboard) reset the primary's password / delete its MFA factor so it
can re-enrol.

## Not built (future, advanced)

- Hardware security keys (WebAuthn) as a second factor.
- Step-up MFA re-challenge for the most destructive actions.
- SIEM export of the audit log.
