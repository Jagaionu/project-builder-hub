## Problem

Creating a company doesn't create a login. The current "invite" hint points to the Supabase dashboard, which you can't access — so there's no email/password for the company.

## Solution

Add a small form inside each company's expanded panel in `/admin` where you type an email + password and click **Create admin user**. The user is created with email auto-confirmed and linked to that company as `admin` in one shot. You then hand those credentials to the customer.

## What I'll build

1. **Server function** `src/lib/admin-users.functions.ts` — `createCompanyAdmin({ companyId, email, password })`:
   - Guarded by `requireSupabaseAuth` + `is_super_admin()` check (rejects non-super-admins).
   - Validates input with Zod (valid email, password ≥ 8 chars).
   - Uses `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true })`.
   - Inserts `{ user_id, company_id, role: 'admin' }` into `company_members`.
   - Returns `{ userId, email }` on success; surfaces clean error messages (e.g. "email already registered").
   - Register `src/start.ts` already has `attachSupabaseAuth` — no change needed.

2. **UI in `src/routes/admin.index.tsx`** — replace the current "invite" placeholder block in the company panel with:
   - Email input
   - Password input (with show/hide toggle and a "Generate" button that fills a 16-char random password)
   - "Create admin user" button → calls the server fn, shows toast on success/error
   - After success: shows a one-time summary card with the email + password and a "Copy credentials" button, so you can paste them to the customer
   - Below it, lists existing `company_members` for that company (so you can see who already has access)

3. **No DB schema changes** — `super_admins`, `company_members`, and the `is_super_admin()` function already exist.

## Notes

- `admin@admin.com` (your super admin) stays as-is and is unrelated to per-company logins.
- This does NOT send any email — credentials are shown to you in the UI only.
- Password rules: min 8 chars (Supabase's HIBP check is currently disabled, so any 8+ char password works).
