# Phase 5 — Render-path & bundle polish

**Status:** ✅ Shipped
**Builds on:** Phase 4 (mutation batching).
**Goal:** Trim what the browser has to download, parse, and re-render
between user actions. After Phases 1–4 the data layer is no longer the
bottleneck on warm paths — what's left is JS bundle size on cold paths and
needless React reconciliation on hot paths.

## Motivation

Profiling after Phase 4 showed two remaining wins:

1. **Cold-load JS weight is dominated by libraries the user may never use
   in a session.** The eager bundle pulled in `recharts` (charts) and
   `exceljs` (CSV/XLSX import + export) the moment any route loaded,
   even though the user might be there to add a single transaction.
2. **The transaction list re-renders every row on every parent state
   change** — `pendingEdits` updates, `selectedIds` toggles, even the
   sticky save-bar appearing — because `TransactionItem` and
   `TransactionGroupHeader` were not memoized and several of the
   handlers passed into them changed identity per render.

Two smaller annoyances were also addressed:

3. `useSyncStatus` re-counted all 7 synced Dexie tables on every offline
   mutation just to update the pending badge.
4. The PWA service worker waited 3 s before falling back to cache for
   Supabase REST calls — a long perceived hang on flaky mobile networks.

## What shipped

### 1. Lazy chart bundles (recharts)

The `recharts` vendor chunk (~380 KB gz 110 KB) is no longer imported
from any module that loads at first paint. Each chart that uses recharts
is now a `React.lazy` import wrapped in `<Suspense>` with a skeleton
fallback:

| Component                | Imported from                                                                                | Loads when                          |
| ------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| `TrendChart`             | [`pages/ReportsPage.jsx`](../../src/pages/ReportsPage.jsx)                                   | User opens the **Trends** tab       |
| `PlanVsActual` (+chart)  | [`pages/ReportsPage.jsx`](../../src/pages/ReportsPage.jsx)                                   | User opens the **Plan vs Actual** tab |
| `CashflowChart`          | [`pages/AccountsPage.jsx`](../../src/pages/AccountsPage.jsx)                                 | User opens the **Cashflow** tab     |
| `NetWorthChart`          | [`components/accounts/NetWorthSummary.jsx`](../../src/components/accounts/NetWorthSummary.jsx) | NetWorthSummary mounts (Accounts overview) |

`CategoryChart` is a pure HTML/Tailwind bar list (no recharts), so it
stays eagerly imported.

### 2. Code-split `exceljs`

`exceljs` (~940 KB gz 270 KB — by far the largest dependency) is now
loaded on demand. Both call sites use a memoized lazy loader:

```js
let _excelJsPromise = null;
function loadExcelJs() {
  if (!_excelJsPromise) {
    _excelJsPromise = import("exceljs").then((m) => m.default || m);
  }
  return _excelJsPromise;
}
```

| File                                                                | When it loads                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`src/services/export.js`](../../src/services/export.js)            | First call to `exportTransactionsCSV` / `exportBudgetCSV`  |
| [`src/utils/csvParser.js`](../../src/utils/csvParser.js)            | First call to `parseSpreadsheetFile` (the import flow)     |

The Vite `manualChunks: { excel: ["exceljs"] }` rule keeps the lib in a
single named chunk; the change here is that nothing in the eager module
graph imports it, so the chunk is only fetched on demand.

### 3. `React.memo` on virtualized rows

[`TransactionItem`](../../src/components/transactions/TransactionItem.jsx)
and [`TransactionGroupHeader`](../../src/components/transactions/TransactionGroupHeader.jsx)
are now wrapped in `React.memo`. The `forwardRef` + `memo` pattern is
preserved so `@tanstack/react-virtual`'s `measureElement` ref still
attaches.

To make the memo actually skip work, the handlers piped into
[`TransactionList`](../../src/components/transactions/TransactionList.jsx)
from [`pages/TransactionsPage.jsx`](../../src/pages/TransactionsPage.jsx)
were stabilised with `useCallback`:

- `handleConfirmAll`, `handleSkipAll`, `handleEditAll`, `handleDeleteAll`
  — group bulk actions invoked from the group header kebab menu.
- `handleConfirmWithSplit` — used both directly (per-row Confirm) and
  indirectly (via the `handleConfirmAll` ref) so the group bulk path
  doesn't change identity on every render.
- `onSplitProp` — replaces the inline `(tx) => setSplittingTransaction(tx)`
  arrow that was being created on every render.

The other props piped into rows were already stable: `mgr.handle*`
were already `useCallback`s, `categories` / `accounts` are
`useMemo`-stabilised query results, and `pendingEdits` is sliced per-row
(`pendingEdits.get(tx.id) || null`) so a single-row edit only changes
that row's `edits` prop.

### 4. O(1) pending-sync counter

`pendingCount()` previously did `db.table(t).where("_offline").equals(1).count()`
across all 7 synced Dexie tables on every call.
[`useSyncStatus`](../../src/hooks/useSyncStatus.js) re-runs on every
queue/sync notification, which during a burst of inline edits meant
dozens of 7-table COUNT scans.

The counter now lives in [`offlineDb.js`](../../src/services/offlineDb.js):

- One full scan on first read populates `_pendingCountCache`.
- `putOffline()` inspects the prior row's `_offline` flag and only
  increments when a clean row transitions to pending.
- `markSynced()` always decrements (the sync engine only calls it for
  rows it pulled out of the offline queue).
- [`syncQueue.enqueue()`](../../src/utils/syncQueue.js) does the same
  pre-read + conditional increment for offline-only updates.

`pendingCount()` is now O(1) after first call. The counter is
intentionally best-effort: if the cache is invalidated (e.g. a future
manual wipe), the next read will re-scan once.

### 5. Service worker: faster fallback + SWR for reference tables

In [`vite.config.js`](../../vite.config.js):

- `networkTimeoutSeconds` for the Supabase REST cache dropped from **3 → 1**.
  On a flaky network, Workbox falls back to the cache (and our Dexie layer)
  in a third the time it used to.
- A new `StaleWhileRevalidate` rule is registered **before** the catch-all
  `NetworkFirst` rule for the three slow-changing reference tables —
  `accounts`, `categories`, `user_preferences`. They serve from cache
  instantly and refresh in the background; cache lifetime is 24 h.

```js
urlPattern:
  /^https:\/\/.*\.supabase\.co\/rest\/v1\/(accounts|categories|user_preferences)\b/i,
handler: "StaleWhileRevalidate",
```

## Bundle map (after)

| Chunk                       | Size (gz) | Loads when                           |
| --------------------------- | --------- | ------------------------------------ |
| `index-*.js` (entry)        | ~93 KB    | First paint                          |
| `vendor-*.js`               | ~12 KB    | First paint                          |
| `supabase-*.js`             | ~46 KB    | First paint                          |
| `utils-*.js`                | ~40 KB    | First paint                          |
| `charts-*.js` (recharts)    | ~111 KB   | First chart actually rendered        |
| `excel-*.js` (exceljs)      | ~271 KB   | First export/import action           |
| `dnd-*.js` (@dnd-kit)       | ~15 KB    | Categories / Annual budget table     |
| `TransactionsPage-*.js`     | ~22 KB    | `/app/transactions` nav              |
| `ReportsPage-*.js`          | ~12 KB    | `/app/reports` nav                   |
| `TrendChart-*.js`           | ~2 KB     | Reports → Trends tab                 |
| `PlanVsActual-*.js`         | ~6 KB     | Reports → Plan vs Actual tab         |
| `CashflowChart-*.js`        | ~3 KB     | Accounts → Cashflow tab              |
| `NetWorthChart-*.js`        | ~2 KB     | Accounts overview mounts             |

(Eager first-paint payload is now ~190 KB gz of JS — the recharts and
exceljs weight is no longer in the critical path.)

## What did NOT change (and why)

- **`@dnd-kit`** is already split into its own ~15 KB chunk and is only
  pulled in by Categories / Annual Budget table — both of which live on
  pages that are themselves route-`lazy()`'d. Splitting it further to
  defer until "edit mode" turns on inside `AnnualBudgetTable` would be
  a structural refactor (the sortable rows are the only row implementation
  today) for a small win. Left as a follow-up if the Budgets-page TTI
  becomes a concern.
- **`useTransactionManager`** still updates local React-Query state
  imperatively. Phase 4's note still applies: switching to `useMutation`
  + `onMutate` is deferrable until profiling shows real flicker.
- **Aggregation memos** (`groupTransactions`, `reportData` on Reports,
  `mergedUpcomingTx` on Accounts) were already inside `useMemo` after
  Phase 2 / Phase 3 work — no change needed.
- **`MetricRow` (PlanVsActualChart)** and **`CategoryBar` (CategoryChart)**
  are local sub-components rendered ≤ a few dozen times per page. They
  don't dominate render cost the way virtualised transaction rows do, so
  they were not memoized.

## Migration steps

No SQL, no schema bump, no cache invalidation needed. Deploy the JS and
the new service worker rolls itself out via `registerType: "autoUpdate"`.

## Risk & rollback

- **Lazy chart load** introduces a one-time chunk fetch the first time a
  chart-bearing tab is opened. Mitigated by the skeleton fallbacks; on a
  fast connection it's imperceptible. Reverting any single chart is one
  `import` line.
- **Pending-sync counter** is a cache. If a developer adds a new write
  path that bypasses both `putOffline` and `syncQueue.enqueue`, the
  counter will drift. Both helpers are documented as the only two valid
  entry points and `bumpPendingCount` is exported with a comment to
  match.
- **`networkTimeoutSeconds: 1`** could mark a slow but viable connection
  as offline and serve stale data ~2 s earlier than before. Acceptable
  given the cache-first design from Phase 1 and the explicit "Refresh"
  affordance.
