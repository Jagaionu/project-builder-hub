# Regenerating Supabase types

`src/integrations/supabase/types.ts` is generated from the live database schema.
After any migration that changes tables/columns/functions, regenerate it so the
typed client stays accurate (avoids as-unknown casts and stale columns).

## One-time setup

```bash
npm i -g supabase            # or use npx supabase
supabase login               # or export SUPABASE_ACCESS_TOKEN=...
```

## Refresh the types

```bash
npm run db:types
```

This runs:

```bash
supabase gen types typescript --project-id ftvzuqmgshbkvjvfzwzv --schema public \
  > src/integrations/supabase/types.ts
```

Commit the regenerated file. Project ref ftvzuqmgshbkvjvfzwzv is not a secret
(it is part of the public Supabase URL); your access token is and must not be
committed.
