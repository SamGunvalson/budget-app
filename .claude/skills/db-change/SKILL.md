---
name: db-change
description: Checklist-driven workflow for any database change in this repo — adding, renaming, or removing a column, table, RPC function, or RLS policy. Use before editing anything under sql_scripts/ or changing column or RPC names in src/services.
---

# Database change

The rules are in `.github/AGENTS.md` under "Database Change Workflow" and
"RLS authoring rules". Read those two sections now if they are not already in
context, then work through the steps below in order. $ARGUMENTS

1. **Locate.** Grep `docs/DATA_MODEL.md` for the table or function and read
   only that section. Grep `sql_scripts/*.sql` (not `migrations/`) for where it
   is currently defined. Grep `src/services/` for every use of the affected
   column or RPC name.
2. **Base script.** Change the current base or feature script so a fresh
   install gets the new shape.
3. **Migration.** Add `sql_scripts/migrations/supabase_<feature>.sql` for
   existing databases. Make it safe to re-run. For policies use
   `DROP POLICY IF EXISTS` + `CREATE POLICY`, and mirror the change in
   `sql_scripts/supabase_rls_complete.sql`.
4. **Self-hosted.** If a new base script was added, list it in
   `sql_scripts/local/apply_order.txt` in dependency order. Do not add
   historical migrations there.
5. **Docs.** Update the table definition, constraints, and RLS note in
   `docs/DATA_MODEL.md`, and the version/date at the bottom.
6. **Services.** Update `src/services/` and, for Dexie-mirrored tables, the
   schema in `src/services/offlineDb.js` and wrappers in
   `src/services/offlineAware.js`.
7. **Check.** Run `npm run verify`. Then ask the `db-reviewer` agent to review
   the diff.
8. **Tell the user** which migration file must be applied by hand to existing
   Supabase projects and self-hosted volumes. Never run SQL against a database
   yourself.
