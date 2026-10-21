# Security Model

This document describes the security invariants the app depends on. Any change to the codebase or backend configuration that violates these invariants **must be reviewed carefully before merging**.

---

## Security Invariants

### 1. Supabase Row-Level Security (RLS) is the last line of defense

Every table that holds user data has RLS enabled with a `USING (auth.uid() = user_id)` policy (see [sql_scripts/supabase_rls_complete.sql](../sql_scripts/supabase_rls_complete.sql)). In self-hosted mode, PostgREST verifies the signed JWT and the local `auth.uid()` compatibility helper supplies the user identity; the same RLS policies still protect data.

**This must never be disabled or weakened.**

Verify at any time by running the diagnostic query at the bottom of `supabase_rls_complete.sql` in the Supabase SQL Editor.

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

The GitHub Actions workflow at [.github/workflows/security.yml](../.github/workflows/security.yml) runs `npm audit --audit-level=high` on every push, PR, and weekly on Mondays.

When `npm audit` reports a vulnerability:

1. Check whether the vulnerable code path is reachable from the app.
2. Update the package if a fix is available: `npm update <package>` or pin via `overrides` in `package.json`.
3. If no fix exists, document the risk and set a review date.
