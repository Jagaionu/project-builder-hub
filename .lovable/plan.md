## Bootstrap super admin account

**Credentials**
- Email: `admin@admin.com` (substituted for `admin@admin` — Supabase requires a valid email format)
- Password: `Madridxtra2509?`

**Steps**
1. Enable `auto_confirm_email` on Supabase Auth so the account is usable immediately without an email verification link.
2. Create the auth user via the admin API with the email + password above.
3. Insert that user's `user_id` into `public.super_admins`.
4. Verify: log in at `/login` → navigate to `/admin` and confirm the super admin dashboard loads.

**Result**
- Logging in with `admin@admin.com` / `Madridxtra2509?` gives you super admin access at `/admin` (company management, module toggles, billing).
- This user is NOT in any company tenant, so the regular `/dispatch`, `/jobs`, etc. routes will redirect — that matches your earlier choice ("super admin only").
- You can change the email/password later from the admin user settings, or I can rotate them on request.