# Historical database upgrades and repairs

These scripts are retained for **existing databases**. They are not part of
[fresh setup](../README.md); their effects are already included there. Filenames
and SQL bodies are preserved so prior upgrade instructions remain identifiable.
Paths now include `migrations/`.

| Script | Existing-database purpose | Current setup equivalent |
| --- | --- | --- |
| [supabase_accounts_closed.sql](./supabase_accounts_closed.sql) | Adds account closure and recurring pause fields | Core base |
| [supabase_asymmetric_transfer.sql](./supabase_asymmetric_transfer.sql) | Adds incoming transfer amount and constraint | Core base |
| [supabase_custom_interval.sql](./supabase_custom_interval.sql) | Adds custom schedule fields and frequency checks | Core base |
| [supabase_split_recurring.sql](./supabase_split_recurring.sql) | Adds recurring split configuration | Core base |
| [supabase_recurring_occurrence_date.sql](./supabase_recurring_occurrence_date.sql) | Backfills occurrence dates, replaces dedup index, and adds lookup index | Core base, including both occurrence indexes |
| [supabase_partnership_seen.sql](./supabase_partnership_seen.sql) | Adds partnership notification watermarks | Split base |
| [supabase_split_dedup.sql](./supabase_split_dedup.sql) | Soft-deletes duplicate linked splits and adds uniqueness | Split base index; fresh databases have no old duplicates |
| [supabase_split_fix_rls.sql](./supabase_split_fix_rls.sql) | Repairs split UPDATE/DELETE policies | Split base and complete RLS |
| [supabase_partnership_hardening_rls.sql](./supabase_partnership_hardening_rls.sql) | Restricts partnership inserts to pending invites, installs the `partnerships_guard` trigger and one-active-partnership indexes, and requires split payers/linked transactions to belong to the partnership/caller | Split base and complete RLS |
| [supabase_split_soft_delete_rpc.sql](./supabase_split_soft_delete_rpc.sql) | Installs the member-scoped `soft_delete_split_expense` RPC; direct soft-delete UPDATEs fail the split SELECT policy | Split base |
| [supabase_transactions_soft_delete_rls.sql](./supabase_transactions_soft_delete_rls.sql) | Atomically replaces legacy transaction policies and installs soft-delete RPC | Core base RPC/policies and complete RLS |
| [supabase_recurring_projection_cleanup.sql](./supabase_recurring_projection_cleanup.sql) | Installs authenticated owner-scoped recurring projection cleanup RPC | Phase-4 mutations |
| [supabase_report_as_of.sql](./supabase_report_as_of.sql) | Replaces plan-vs-actual and spending-trend RPCs with versions taking optional `p_as_of`, so reports can exclude projected/pending/future rows | Phase-3 aggregations |
| [supabase_recurring_group_new_children.sql](./supabase_recurring_group_new_children.sql) | Replaces `upsert_recurring_group` so children added while editing a group are kept instead of deactivated | Phase-4 mutations |

## Applying upgrades

- Inspect the current schema and the release instructions, then back up.
- Core tables must exist before their ALTER/policy fixes; partnership/split
  tables must exist before their upgrades.
- Apply missing column upgrades before newer feature/RPC scripts that reference
  those columns. Apply transaction soft-delete repair before complete RLS on a
  legacy installation. Complete RLS references partnership/split tables.
- Do not blanket-run every historical script: occurrence backfill and split
  deduplication change existing data, and index creation can expose old duplicates.
- Do not assume every script is transactional or safe to rerun after a partial
  failure. Read its SQL and stop on errors.

Supabase: run the required script as the database owner in the SQL Editor.
Self-hosted: use the updated database image, which bundles this directory:

```bash
# Example repair only; choose the migration required by your release.
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost exec -T db \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f /sql_scripts/migrations/supabase_transactions_soft_delete_rls.sql
```

The retained [`local/98_local_fixes.sql`](../local/98_local_fixes.sql) entrypoint
delegates to that shared repair using a relative include. It remains usable
for old local deployment instructions but is no longer run on fresh databases.
Never delete a database volume to apply an upgrade.
