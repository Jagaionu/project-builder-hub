## Goal
Declare `manual_override` on the `Job` type so the auto-planner doesn't need ad-hoc casts.

## Change
**`src/lib/types.ts`** — add one optional field to the `Job` interface:
```ts
manual_override?: boolean;
```

**`src/lib/dispatch/use-auto-planner.ts`** — remove the three `(j as { manual_override?: boolean })` casts; access `j.manual_override` directly.

## Out of scope
No DB migration (the `jobs.manual_override` column already exists per `src/integrations/supabase/types.ts`). No behavior change — purely a type cleanup.
