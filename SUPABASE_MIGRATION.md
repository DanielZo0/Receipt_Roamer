# Moving off the Lovable-managed Supabase project

The app currently talks to a Supabase project that Lovable provisioned
(`cafnuafttcbudobpvgna`, see `supabase/config.toml`). Lovable's own tooling can
apply schema changes to that project independently of the migration files
tracked in `supabase/migrations/` — that's how a past migration
(`20260705000000_duplicate_detection_and_category_rules.sql`) ended up in the
repo but never applied to the live database. Moving to a Supabase project you
provision and control directly removes that back-channel: from then on, the
only way schema changes reach the database is through the migration files in
this repo, applied deliberately.

The app itself is unaffected by this — it already connects entirely through
environment variables (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, plus the `VITE_` prefixed browser variants), so
nothing in the code is tied to the specific project.

## Steps

1. **Create the new Supabase project** at [supabase.com](https://supabase.com/dashboard) under your own account.

2. **Create the storage bucket.** In the new project's Storage tab, create a
   **private** bucket named exactly `receipts`. The app uploads receipt
   images/PDFs here.

3. **Run the combined migration.** Open the SQL editor in the new project and
   paste the entire contents of
   [`supabase/migrations/combined_fresh_project.sql`](supabase/migrations/combined_fresh_project.sql),
   then run it. This creates all tables, RLS policies, indexes, and seed
   categories in one shot (it's the 11 migrations in `supabase/migrations/`
   concatenated in order, wrapped in a transaction).

4. **Collect credentials.** From Project Settings:
   - **API** tab: `SUPABASE_URL` (Project URL) and the anon/public key
     (`SUPABASE_PUBLISHABLE_KEY`), plus the **service_role** key
     (`SUPABASE_SERVICE_ROLE_KEY` — used server-side by
     `src/integrations/supabase/client.server.ts` to bypass RLS for admin
     operations; keep this secret, never expose it to the browser).
   - **Database** tab: the direct Postgres connection string, as
     `DATABASE_URL`. This isn't used by the app itself — only by
     `npm run db:check` (see below) to verify the schema locally.

5. **Update Railway.** In the Railway project's Variables tab, set:
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` to the new project's
   values, then trigger a redeploy.

6. **Update local `.env`** the same way, and add `DATABASE_URL` for the
   schema-check script.

7. **Update `supabase/config.toml`** — change `project_id` to the new
   project's ref (visible in the dashboard URL or Project Settings → General).

8. **Verify.** Log into the app, upload a test receipt, and confirm it shows
   up in the new project's `expenses` table and `receipts` bucket. Then run
   `npm run db:check` (see [Schema drift checks](#schema-drift-checks) below)
   to confirm the schema matches what the app expects.

9. **Decommission (optional).** Once you're confident everything works
   against the new project, the old Lovable-provisioned project can be left
   idle or deleted — that's your call, not something this change does
   automatically.

## Schema drift checks

`npm run db:check` connects directly to Postgres via `DATABASE_URL` and
compares the live schema against `scripts/expected-schema.ts` (a
hand-maintained list mirroring `src/integrations/supabase/types.ts`). It
prints any table or column the app expects but that's missing from the
database — the exact failure mode that caused the original bug.

Run it manually after pulling changes that touch `supabase/migrations/`, or
whenever you're unsure whether a migration was actually applied. It's not
wired into the Railway build, so it never blocks a deploy on its own.

When you add a new migration that changes the schema, update
`scripts/expected-schema.ts` in the same change (same discipline as updating
`src/integrations/supabase/types.ts`).
