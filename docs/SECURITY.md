# Security Model

This document describes the security invariants the app depends on. Any change to the codebase or backend configuration that violates these invariants **must be reviewed carefully before merging**.

---

## Security Invariants

### 1. Supabase Row-Level Security (RLS) is the last line of defense

Public financial tables have RLS enabled, scoped by owner or parent/partnership
membership (see [complete policies](../sql_scripts/supabase_rls_complete.sql)
and [data-model contracts](./DATA_MODEL.md)). Not every table has a `user_id`
column. In self-hosted mode, PostgREST verifies the signed JWT and the local
`auth.uid()` compatibility helper supplies identity; the same policies protect
public data. Auth tables are isolated by backend-managed access/local grants
and must not be exposed through PostgREST.

**This must never be disabled or weakened.**

Verify at any time by running the diagnostic query at the bottom of `supabase_rls_complete.sql` in the Supabase SQL Editor.

Transaction SELECT/UPDATE policies must also require `deleted_at IS NULL` in
USING, while UPDATE WITH CHECK checks ownership without that condition.
A permissive transactions FOR ALL policy defeats the live-row filter even when
the narrower policies exist. For existing Supabase databases, run
[migrations/supabase_transactions_soft_delete_rls.sql](../sql_scripts/migrations/supabase_transactions_soft_delete_rls.sql)
as the database owner before reapplying the complete RLS script. It atomically
replaces the legacy policy and installs the authenticated-only soft-delete RPC.
The RPC uses SECURITY DEFINER with explicit ownership/live-row predicates and a
fixed search path. The migration's final query must show four authenticated
transaction policies (SELECT, INSERT, UPDATE, DELETE), no ALL or extra permissive
policies. This preserves existing owner-only hard deletes; it does not purge data.

Recurring projection cleanup also uses an authenticated-only SECURITY DEFINER
RPC, [installed by this upgrade](../sql_scripts/migrations/supabase_recurring_projection_cleanup.sql).
It requires an explicit ID scope and date cutoff, and checks ownership, live
rows, recurring linkage, and projected/pending status in the UPDATE itself.
It returns only a count, never hidden deleted rows. Do not replace this with
direct client soft-delete UPDATEs or widen SELECT visibility to enable cleanup.

### 2. All mutations also filter by user_id in application code

Even though RLS enforces data isolation at the database level, every `UPDATE` and `DELETE` query in [src/services/transactions.js](../src/services/transactions.js) and [src/services/accounts.js](../src/services/accounts.js) also includes `.eq("user_id", user.id)`.  
This is defense-in-depth: if RLS is ever misconfigured, the application layer still prevents cross-user mutations.  
**Never remove `.eq("user_id", user.id)` from mutation queries without a documented reason.**

### 3. No dangerouslySetInnerHTML

React auto-escapes all JSX interpolations, preventing reflected XSS. The app has zero uses of `dangerouslySetInnerHTML`.  
**This must remain zero. Any PR introducing it requires explicit security sign-off.**

### 4. Offline data is cleared on logout

The `signOut()` wrapper in [src/services/backend.js](../src/services/backend.js) clears offline data and session storage before ending the selected backend session through the [auth adapter](../src/services/auth/).
**Never call `supabase.auth.signOut()` directly; route auth operations through the adapter and logout wrapper.**

### 5. All user-data routes require authentication

Every route under `/app/*` is wrapped in `ProtectedRoute`, which checks the selected auth adapter session before rendering. Public routes (`/`, `/auth`) do not have access to user data.

**Any new page added under `/app/` must use `ProtectedRoute`.**

### 6. Anon key is the only credential in the browser bundle

`VITE_SUPABASE_ANON_KEY` is the only Supabase credential baked into a Supabase-mode frontend build; it is intentionally public by Supabase design. The `service_role` key must **never** appear in `VITE_*` variables or anywhere in the frontend codebase. Local mode must not embed database or JWT signing secrets in the client.

### 7. File import is size- and row-limited

[src/utils/csvParser.js](../src/utils/csvParser.js) rejects files larger than 10 MB before loading them into memory.  
[src/services/import.js](../src/services/import.js) rejects batches exceeding 5,000 rows.  
**These limits must not be raised without evaluating memory and denial-of-service risk.**



## Self-hosted local backend

The self-hosted Compose stack uses PostgreSQL, PostgREST, a Fastify auth service,
and Nginx. Preserve these deployment invariants:

- `JWT_SECRET` is shared by PostgREST and the auth service. Keep it private and
  identical in both services. Rotating it requires updating both together; existing
  access JWTs stop verifying, so clients must refresh them with a still-valid
  refresh token or sign in again.
- Access JWTs are short-lived. Refresh tokens rotate on use, are stored in the
  database only as SHA-256 hashes, and reuse of a revoked token revokes its token
  family. Passwords are bcrypt-hashed.
- The auth service applies per-IP rate limits and per-email failed-login lockout.
  Nginx overwrites (never appends to) `X-Forwarded-For` for the auth upstream,
  and the auth service honors that header only from private-range peers
  (`TRUST_PROXY`). Do not publish the auth port or set `TRUST_PROXY=true` on a
  directly reachable service.
  Keep these protections enabled; do not expose the service directly.
- The `anon` role has no public table, sequence, or function grants (it has only
  schema/helper access). `authenticated` access is constrained by RLS.
- The self-hosted Compose file publishes only the app/Nginx port; Postgres,
  PostgREST, and auth stay on the internal Compose network. Keep that boundary.
- CORS on the local API is limited to Capacitor WebView origins
  (`capacitor://localhost`, `https://localhost`, and the configured local
  `http://localhost` origin). Do not replace this with a wildcard.
- Set `ALLOW_SIGNUP=false` after creating the intended accounts. Nginx serves
  plain HTTP: expose it only over a trusted encrypted network such as Tailscale,
  or set `APP_BIND=127.0.0.1` and put a TLS-terminating reverse proxy in front
  of it. Do not expose credentials or financial data over public plaintext HTTP.
- Keep `.env.selfhost` out of version control. Protect database backups as
  sensitive financial and authentication data, and test restores.

---

## Threat Model Summary

| Threat                                                              | Mitigation                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Horizontal privilege escalation (User A reads/writes User B's data) | RLS on all tables + `user_id` filter on all mutations                                 |
| XSS → data exfiltration                                             | No `dangerouslySetInnerHTML`; Content-Security-Policy header restricts script sources |
| Clickjacking                                                        | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`                                |
| MIME sniffing                                                       | `X-Content-Type-Options: nosniff`                                                     |
| Sensitive data left in browser after logout                         | `clearAllOfflineData()` + `sessionStorage.clear()` on sign-out                        |
| Memory exhaustion via large file upload                             | 10 MB file size guard before `arrayBuffer()`                                          |
| Credential leakage                                                  | Only anon key in bundle; service key never in frontend                                |

---

## Dependency Vulnerability Scanning

Run locally:

```bash
cd budget-app
npm run audit:security
```

The [scheduled security workflow](../.github/workflows/security.yml) runs
`npm audit --audit-level=high` and lint weekly on Mondays. The
[Docker publishing workflow](../.github/workflows/docker-publish.yml) runs
audit/lint quality gates on main pushes, matching version tags, and PRs to main,
plus an isolated self-hosted deployment smoke test. These frontend dependency
audits use the root lockfile; the auth service and migration utility have
separate manifests/lockfiles.

When `npm audit` reports a vulnerability:

1. Check whether the vulnerable code path is reachable from the app.
2. Update the package if a fix is available: `npm update <package>` or pin via `overrides` in `package.json`.
3. If no fix exists, document the risk and set a review date.
