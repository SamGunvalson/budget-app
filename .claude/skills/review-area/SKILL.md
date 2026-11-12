---
name: review-area
description: Review one area of the codebase (or the whole repo) with the project's reviewer agents, then verify and rank the findings. Use when asked for a code review of existing code rather than of a diff. For reviewing a diff or PR, use /code-review instead.
---

# Review an area

Scope requested: $ARGUMENTS (if empty, ask which area, or confirm a full-repo review).

Split the scope into slices of roughly 4,000–6,000 lines so each reviewer can
read its files in full. The standard slices for a full review:

| Slice | Agent | Paths |
| --- | --- | --- |
| Offline and sync | code-reviewer | `src/services/offlineAware.js`, `offlineDb.js`, `sync.js`, `cache.js`, `queryBridge.js`, `queryClient.js`, `src/utils/syncQueue.js` |
| Services | code-reviewer | the rest of `src/services/`, `src/utils/` |
| Hooks, contexts, pages | code-reviewer | `src/hooks/`, `src/contexts/`, `src/pages/`, `src/App.jsx`, `src/main.jsx` |
| Transactions UI | code-reviewer | `src/components/transactions/`, `src/components/common/` |
| Budgets, reports, accounts, splits UI | code-reviewer | the other `src/components/` folders |
| Auth service and tooling | code-reviewer | `server/auth/`, `scripts/`, `vite.config.js`, Docker and nginx config |
| Database | db-reviewer | `sql_scripts/`, `docs/DATA_MODEL.md` |

Steps:

1. Launch the slices in parallel, one agent each. Give each its exact paths
   and nothing else; the agent definitions already carry the review criteria.
2. When they return, check every critical and high finding yourself by reading
   the cited lines. Drop the ones that do not hold and say how many you dropped.
3. Merge duplicates, rank by severity, and report: a short verdict, then the
   findings table (location, defect, scenario, fix), then themes that showed
   up in more than one slice.
4. Do not fix anything unless asked. Offer to fix by severity tier.
