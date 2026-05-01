# Security Review — Index

This directory holds the deliverables from the multi-phase security
review. Compliance target: **OWASP Top 10 (2021) + ASVS L1**.

| Phase | Document                                                               | Status                                         |
| ----- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| 1     | [Threat model & asset map](./00-threat-model.md)                       | Complete                                       |
| 2     | [Database & RLS audit](./02-database-rls-audit.md)                     | Audit complete; remediations queued            |
| 3     | [Frontend / PWA audit](./03-frontend-pwa-audit.md)                     | High/Medium fixes shipped; 3 items open        |
| 4     | [Build / deploy / container hardening](./04-build-deploy-hardening.md) | Audit complete; PRs queued                     |
| 5     | [Offline storage & sync audit](./05-offline-storage-audit.md)          | Audit complete; F-OF-002 needs design decision |
| 6     | [Dependencies, secrets, CI guardrails](./06-dependencies-ci.md)        | Audit complete; PR P6-1 queued                 |

## Fixes shipped in this review pass

- **F-FE-001 (High)** — CSV formula injection on export → `sanitizeCell()` in [src/services/export.js](../../src/services/export.js)
- **F-FE-002 (Medium)** — Prototype pollution via crafted CSV header → `Object.create(null)` rows + reserved-name guard in [src/utils/csvParser.js](../../src/utils/csvParser.js)
- **F-FE-003 (High)** — Service worker would precache `env-config.js` → `globIgnores` + `NetworkOnly` rule in [vite.config.js](../../vite.config.js); `Cache-Control: no-store` in [nginx.conf](../../nginx.conf)
- **F-FE-004 / F-OF-001 (Medium)** — `signOut` now clears Workbox caches + scoped localStorage in addition to IndexedDB + sessionStorage ([src/services/supabase.js](../../src/services/supabase.js))
- **F-FE-005 (Low)** — Misleading "end-to-end encryption" copy removed from [src/pages/AuthPage.jsx](../../src/pages/AuthPage.jsx)
- **F-AC-001 (Medium)** — Defense-in-depth `.eq("user_id", user.id)` added to `confirmTransaction`, `updateTransfer` legs, `updateLinkedTransfer` legs ([src/services/transactions.js](../../src/services/transactions.js))

## Open follow-ups by PR group

- **P2-1** Database hardening — F-DB-002, F-DB-003, F-DB-006
- **P2-2** Database hygiene — F-DB-001, F-DB-004 (+ optional F-DB-005)
- **P3-2** Frontend defense-in-depth — F-FE-006, F-FE-007
- **P3-3** Logging hygiene — F-FE-008
- **P4-1** Container hardening — F-CI-001, F-CI-002, F-CI-008
- **P4-2** Entrypoint robustness — F-CI-003
- **P4-3** Workflow hardening — F-CI-004, F-CI-005, F-CI-006, F-CI-007
- **P5-1** Sync queue identity tagging — F-OF-003
- **P5-2** Soft-delete compaction — F-OF-004
- **P5-3** Cleanup unit tests — verification harness
- **P5-? Design decision** — F-OF-002 IndexedDB encryption (A/B/C)
- **P6-1** Security CI bundle — F-CI-101 through F-CI-106, F-CI-109
- **P6-2** Vitest + regression tests — F-CI-107
