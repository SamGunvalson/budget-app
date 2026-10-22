# Local PostgreSQL compatibility shim

Only for vanilla PostgreSQL 16 + PostgREST, **not Supabase**.
`apply_order.txt` is the canonical fresh-database order;
it documents migrations already folded into the base scripts. The base scripts
create tables without IF NOT EXISTS, so the full initializer is not re-runnable.
The role, auth-schema, grants, and local-fix scripts are individually idempotent.

The self-hosted database image builds from [`../Dockerfile`](../Dockerfile),
bundling the SQL files at `/sql_scripts` and executable `local/init.sh` at
`/docker-entrypoint-initdb.d/00-budget.sh` on top of PostgreSQL 16. The deployment
Compose file needs no source checkout or SQL mounts.
Set `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`,
`AUTHENTICATOR_PASSWORD`, and `AUTH_ADMIN_PASSWORD`. `SQL_DIR` optionally changes
the SQL directory path. Passwords are passed as quoted psql variables, not SQL text
substitution inside DO blocks. Initialization only runs for an empty data volume;
changing password environment variables alone does not rotate existing roles.
Existing volumes are preserved on image updates; apply only the release's
required migrations explicitly using `psql -X -v ON_ERROR_STOP=1 -f /sql_scripts/<migration>.sql`
inside the updated database container. Do not rerun the fresh-install initializer.

- `authenticator`: LOGIN NOINHERIT; PostgREST connection role, may SET ROLE
  `anon` or `authenticated` according to verified JWTs.
- `authenticated`: NOLOGIN; public table CRUD, sequences and RPCs, with RLS.
- `anon`: NOLOGIN; schema/helper access only, no public data or RPC execution.
- `auth_admin`: LOGIN; auth-service CRUD on `auth.users` and
  `auth.refresh_tokens` only, not public financial tables. It is not an RLS bypass.
- Only the database owner creates schema objects. Default public grants apply
  to future objects created by that same owner; rerun grants for other owners.

PostgREST must expose **only `public`**, never `auth`. JWTs need `sub`, lowercase
`email`, `role: authenticated`, and `aud: authenticated`. Auth helpers tolerate
missing/empty claim settings. No API role can read passwords or refresh hashes.
`get_partner_email` keeps its authenticated-only, invitee-membership-scoped
SECURITY DEFINER behavior.

`98_local_fixes.sql` delegates to the shared
[`supabase_transactions_soft_delete_rls.sql`](../supabase_transactions_soft_delete_rls.sql)
migration. The base schema now includes its `soft_delete_transaction(txn_id uuid)`
RPC and authenticated-only, per-operation transaction policies. The migration
also repairs existing databases by removing the legacy permissive FOR ALL
policy. The RPC uses explicit ownership checks under SECURITY DEFINER to permit
soft deletes without widening access. The existing split policies are preserved.

After initializing a disposable local database, run the transaction RLS
regression checks as its owner (never against live Supabase):

```bash
psql -X -v ON_ERROR_STOP=1 -U postgres -d budget_test \
  -f sql_scripts/local/tests/transactions_rls.sql
```

The checks use two test users and roll back all fixtures. They cover live-row
visibility, ownership enforcement, authenticated RPC grants, soft deletes,
repeat/missing-ID calls, and preservation of existing owner-only hard deletes.
