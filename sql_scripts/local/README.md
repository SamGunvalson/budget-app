# Local PostgreSQL compatibility shim

Only for vanilla PostgreSQL 16 + PostgREST, **not Supabase**. Existing Supabase
SQL remains unchanged. `apply_order.txt` is the canonical fresh-database order;
it documents migrations already folded into the base scripts. The base scripts
create tables without IF NOT EXISTS, so the full initializer is not re-runnable.
The role, auth-schema, grants, and local-fix scripts are individually idempotent.

Mount `sql_scripts/` read-only at `/sql_scripts` and executable `local/init.sh`
at `/docker-entrypoint-initdb.d/00-budget.sh` in the official Postgres image.
Set `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`,
`AUTHENTICATOR_PASSWORD`, and `AUTH_ADMIN_PASSWORD`. `SQL_DIR` optionally changes
the SQL mount path. Passwords are passed as quoted psql variables, not SQL text
substitution inside DO blocks. Initialization only runs for an empty data volume;
changing password environment variables alone does not rotate existing roles.

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

`98_local_fixes.sql` supplies the client RPC `soft_delete_transaction(txn_id uuid)`
missing from the repository's Supabase scripts. It uses explicit ownership checks
under SECURITY DEFINER to permit soft deletes without widening access. It also
removes the legacy audit script's permissive transactions FOR ALL policy, which
would otherwise override the base schema's live-row SELECT/UPDATE filtering.
The existing split policies are preserved.
