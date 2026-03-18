# Security Model

This document describes the security invariants the app depends on. Any change to the codebase or Supabase configuration that violates these invariants **must be reviewed carefully before merging**.

---

## Security Invariants

### 1. Supabase Row-Level Security (RLS) is the last line of defense

Every table that holds user data has RLS enabled with a `USING (auth.uid() = user_id)` policy (see [sql_scripts/supabase_rls_complete.sql](../sql_scripts/supabase_rls_complete.sql)).  
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

`signOut()` in [src/services/supabase.js](../src/services/supabase.js) calls `clearAllOfflineData()` before ending the Supabase session, ensuring no financial data persists in IndexedDB or sessionStorage after a user logs out.  
**Never call `supabase.auth.signOut()` directly; always go through the `signOut()` wrapper.**

### 5. All user-data routes require authentication

Every route under `/app/*` is wrapped in `ProtectedRoute`, which checks `supabase.auth.getSession()` before rendering. Public routes (`/`, `/auth`) do not have access to user data.  
**Any new page added under `/app/` must use `ProtectedRoute`.**

### 6. Anon key is the only credential in the browser bundle

`VITE_SUPABASE_ANON_KEY` is the only Supabase credential baked into the frontend build. It is intentionally public (Supabase design). The `service_role` key must **never** appear in `VITE_*` variables or anywhere in the frontend codebase.

### 7. File import is size- and row-limited

[src/utils/csvParser.js](../src/utils/csvParser.js) rejects files larger than 10 MB before loading them into memory.  
[src/services/import.js](../src/services/import.js) rejects batches exceeding 5,000 rows.  
**These limits must not be raised without evaluating memory and denial-of-service risk.**

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
