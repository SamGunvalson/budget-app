# Budget App — Claude Code entry point

Architecture, conventions, and the database change workflow live in one shared
file so every AI tool reads the same rules. Do not duplicate them here.

@.github/AGENTS.md

## Verifying changes

- `npm run verify` — lint + unit tests + production build. Run before calling work done.
- `npm test` — fast unit tests only (no Docker or database needed).
- A hook lints each `.js`/`.jsx` file as you edit it; fix what it reports immediately.
- Auth-service, self-host smoke, and RLS tests need Docker/PostgreSQL. Do not run
  them unless asked; say they were not run.

## Keeping context small

- Read the big references by section, not whole: grep the heading first, then
  read that range. `docs/DATA_MODEL.md`, `docs/STYLE_GUIDE.md`, and
  `docs/SETUP_GUIDE.md` are 25–30 KB each.
- `docs/archive/` is historical. Never treat it as current; skip it unless asked.
- These files are over 1,000 lines — grep for the function, then read a range:
  `src/services/offlineAware.js`, `src/services/recurring.js`,
  `src/pages/TransactionsPage.jsx`, `src/components/budgets/AnnualBudgetTable.jsx`,
  `src/components/transactions/RecurringGroupForm.jsx`.
- Build output, lockfiles, and secrets are blocked in `.claude/settings.json`.

## Delegation

Project agents live in `.claude/agents/`. Use them when the user asks for a
review or verification pass, so the noisy work stays out of the main context:

- `verifier` (Haiku) — runs lint/tests/build, returns only failures.
- `code-reviewer` (Sonnet) — reviews a diff or a named area against project invariants.
- `db-reviewer` (Sonnet) — reviews SQL, RLS, and data-model/service consistency.

Skills: `/db-change` (schema change checklist), `/verify`, `/review-area`.
