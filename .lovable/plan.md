## Problem

When you click **Generate credentials** for a company whose admin user already exists, the UI shows a brand-new password — but logging in with it fails. Reason: the server only saves the password when it *creates* the user. On the "user already exists" path, it looks up the existing account and returns it without ever updating the password, so the value shown on screen was never written to the auth database.

## Fix

In `src/lib/admin-users.functions.ts` → `createCompanyAdmin`, after we resolve the existing user id on the duplicate-email branch, call the Supabase Admin API to actually rotate the password and confirm the email:

```ts
await supabaseAdmin.auth.admin.updateUserById(userIdToLink, {
  password: data.password,
  email_confirm: true,
});
```

This makes the "Generate credentials" button behave as a true password-rotation action: whether the user is new or existing, the password shown in the UI is the one stored in the database.

## Scope

- Edit only `src/lib/admin-users.functions.ts` (the `createCompanyAdmin` handler, duplicate-email branch).
- No schema changes, no UI changes, no other files touched.
- Behavior for brand-new users is unchanged (still uses `createUser` with the password).

## Verification

After the change, on the `/admin` page:
1. Expand a company and click **Generate credentials** twice in a row.
2. Copy the second password and sign in at `/login` with the displayed email — it should work.
