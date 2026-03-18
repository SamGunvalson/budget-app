# Security Code Review Checklist

Use this checklist when reviewing any PR that touches data services, forms, routing, or infrastructure. A "yes" to every applicable question is the bar for merge.

---

## Data Services (`src/services/`)

- [ ] Does every `UPDATE` or `DELETE` query include **both** `.eq("id", id)` and `.eq("user_id", user.id)`?
- [ ] Does every `INSERT` set `user_id: user.id` explicitly?
- [ ] Is `user.id` obtained from `getCurrentUser()` or `supabase.auth.getUser()` — not from client-supplied input?
- [ ] Are there any raw SQL strings (template literals passed to `supabase.rpc` or similar)? If yes, are all parameters passed as bound arguments, never interpolated into the SQL string?
- [ ] Does any new service function need a corresponding RLS policy in `supabase_rls_complete.sql`?

## File Import / Upload (`src/utils/csvParser.js`, `src/services/import.js`)

- [ ] Is file size checked with a guard (`file.size > MAX_IMPORT_FILE_BYTES`) **before** calling `file.arrayBuffer()`?
- [ ] Is row count checked against `MAX_IMPORT_ROWS` before processing begins?
- [ ] Are parsed numeric values checked against reasonable bounds (amount ≤ 99,999,999 cents)?

## Forms & Input (`src/components/`)

- [ ] Is all user-supplied text trimmed and validated before being passed to a service function?
- [ ] Is `dangerouslySetInnerHTML` used anywhere? **If yes — block the PR and require explicit security review.**
- [ ] Are error messages shown to the user free of raw server/DB error details that could leak implementation information?

## Routing & Authentication (`src/pages/`, `src/App.jsx`)

- [ ] Is every new page under `/app/*` wrapped in `ProtectedRoute`?
- [ ] Does any new public route accidentally expose data meant only for authenticated users?

## Logout & Session Cleanup

- [ ] If a new sign-out code path is introduced, does it go through the `signOut()` wrapper in `src/services/supabase.js` (which calls `clearAllOfflineData()` and `sessionStorage.clear()`)?

## Infrastructure (`nginx.conf`, `Dockerfile`, `docker-compose.yml`)

- [ ] Are all six security headers still present in `nginx.conf` after any changes?
- [ ] Does the `Content-Security-Policy` still restrict `connect-src` to `'self'` and `*.supabase.co`?
- [ ] Are any new environment variables that are secrets excluded from `VITE_*` prefixes (which would expose them in the browser bundle)?

## Dependencies (`package.json`)

- [ ] Run `npm run audit:security` locally. Are there any **high** or **critical** findings?
- [ ] If a new dependency is added, does it have a recent release history and no known high/critical CVEs?

---

## After Merging

- [ ] If RLS policies were changed: run the diagnostic query in `sql_scripts/supabase_rls_complete.sql` to confirm all tables still show `rls_enabled = true` with at least one policy.
- [ ] If `nginx.conf` was changed: test the deployed instance at [securityheaders.com](https://securityheaders.com) and confirm the grade did not drop.
