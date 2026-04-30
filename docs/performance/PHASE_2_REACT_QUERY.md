# Phase 2 — React Query adoption + invalidation bus

**Status:** Shipped
**Touches:** `package.json` (added `@tanstack/react-query`),
`src/services/queryClient.js` (new), `src/services/queryBridge.js` (new),
`src/hooks/queries.js` (new), `src/main.jsx`,
`src/services/offlineAware.js`, `src/services/offlineDb.js`,
`src/components/common/SyncStatus.jsx`,
several pages + reports components (consumer conversions),
`docs/DATA_MODEL.md` (client-cache section update).

## Why

Phase 1 made reads cache-first at the **service** layer: every `*Offline`
call now returns the Dexie row immediately and revalidates in the
background. But each page still owned its own `useState` + `useEffect` +
local `refreshXxx()` choreography, which meant:

- Two components reading the same table fired the same `swrRead` twice on
  mount (Phase 1's in-flight de-dup helps for the network call but not for
  the React render path).
- Mutations had to manually `await refreshAccounts()` / `await
loadTransactions()` afterwards, scattering invalidation logic across
  every page and component.
- The "data refreshed" signal from `cache.notifyTable` had no automatic
  consumer in React — the TopBar pill subscribed, but page-level state
  did not.

Phase 2 makes **React Query** the single L1 cache and invalidation bus
sitting on top of the Phase 1 SWR layer.

## What changed

### 1. `services/queryClient.js` (new)

A singleton `QueryClient` with these defaults:

```js
{
  queries: {
    staleTime: 5 * 60 * 1000,      // 5m — Dexie revalidation handles freshness
    gcTime:    30 * 60 * 1000,     // 30m — keep cached data through navigation
    refetchOnWindowFocus: false,   // we already have notifyTable + the bridge
    refetchOnReconnect:   true,    // useful on flaky networks
    retry: 1,
  },
  mutations: { retry: 0 },
}
```

`staleTime` is intentionally generous because the underlying `*Offline`
function returns the Dexie cache immediately — React Query doesn't need to
chase freshness on its own; the bridge below does it.

### 2. `services/queryBridge.js` (new) — Phase 1 ↔ React Query bridge

`initQueryBridge()` is called once at app boot from `main.jsx`. It
subscribes to `cache.subscribeTable(t, …)` for each of the seven mirrored
tables and calls

```js
queryClient.invalidateQueries({ queryKey: [tableName], refetchType: "active" });
```

whenever Phase 1 announces fresh data (or whenever a mutation calls
`notifyTable(t)` directly).

It also installs **cross-table dependencies** for transactions:
`notifyTable("transactions")` additionally invalidates the
`["accounts", "balances"]`, `["accounts", "netWorthHistory"]`,
`["accounts", "balanceHistory"]`, and `["accounts", "maxProjectedDate"]`
query keys, because those derived account queries are computed from
transactions and would otherwise go stale.

`refetchType: "active"` means only mounted consumers refetch — background
queries are simply marked stale and will refetch on next mount.

### 3. `services/offlineAware.js` + `services/offlineDb.js` — wire `notifyTable` into mutations

- `putOffline()` now calls `notifyTable(tableName)` after the queued put,
  covering every offline-only mutation path (any code that goes through
  `putOffline`).
- Each `*Offline` mutation in `offlineAware.js` (`createTransaction`,
  `updateAccount`, `closeAccount`, `pauseRecurringTemplate`, …) calls
  `notifyTable(t)` after the online success branch as well, so online
  mutations don't have to wait for the next pull tick to invalidate
  consumers.

This is the single mechanism that ties mutations to consumer refresh.
Application code never has to call `queryClient.invalidateQueries`
manually — the bridge takes care of it.

### 4. `hooks/queries.js` (new) — read-hook library

A flat library of `useQuery` wrappers, all keyed under
`[tableName, ...specifics]`:

| Hook                                    | Query key                                           | Underlying call                   |
| --------------------------------------- | --------------------------------------------------- | --------------------------------- |
| `useTransactions(filters)`              | `["transactions", "list", { month, year, status }]` | `getTransactionsOffline`          |
| `useTransactionsForYear(year)`          | `["transactions", "year", year]`                    | `getTransactionsForYearOffline`   |
| `useTransactionsYTD(year, month)`       | `["transactions", "ytd", year, month]`              | `getTransactionsYTDOffline`       |
| `usePendingReviewCount()`               | `["transactions", "pendingReviewCount"]`            | `getPendingReviewCountOffline`    |
| `useAccounts()`                         | `["accounts", "list"]`                              | `getAccountsOffline`              |
| `useAccountBalances({projectedToDate})` | `["accounts", "balances", projectedToDate]`         | `getAccountBalancesOffline`       |
| `useNetWorthHistory({projectedToDate})` | `["accounts", "netWorthHistory", projectedToDate]`  | `getNetWorthHistoryOffline`       |
| `useMaxProjectedDate()`                 | `["accounts", "maxProjectedDate"]`                  | `getMaxProjectedDateOffline`      |
| `useAccountBalanceHistory(opts)`        | `["accounts", "balanceHistory", opts]`              | `getAccountBalanceHistoryOffline` |
| `useUpcomingTransactions({accountIds})` | `["transactions", "upcoming", { accountIds }]`      | `getUpcomingTransactionsOffline`  |
| `useCategories()`                       | `["categories", "list"]`                            | `getCategoriesOffline`            |
| `useUserPreference(key)`                | `["user_preferences", key]`                         | `getUserPreferenceOffline`        |
| `useBudgetPlan(month, year)`            | `["budget_plans", month, year]`                     | `getBudgetPlanOffline`            |
| `useBudgetItems(planId)`                | `["budget_items", planId]`                          | `getBudgetItemsOffline`           |
| `useTemplatesForAccount(accountId)`     | `["recurring_templates", accountId]`                | `getTemplatesForAccountOffline`   |

Each hook accepts an `{ enabled }` option (e.g. so `PlanVsActual` can
choose between the monthly and YTD queries based on `viewMode`).

### 5. Mutations stay imperative

Phase 2 explicitly **does not** convert mutation calls into
`useMutation` hooks. Components keep calling `createAccount(values)` /
`bulkUpdateTransactions(ids, …)` etc. directly; the bridge handles
invalidation. Two reasons:

1. The optimistic-edit hook (`useTransactionManager`) already manages
   transaction-list state itself; folding it into `useMutation` would
   require a significant rewrite without a perf win.
2. Most mutation callsites already have the right `try/catch` +
   error-state plumbing; wrapping them in `useMutation` would be
   churn for churn's sake.

For the small handful of consumers that own a `transactions` array
locally (`TransactionsPage`, `CategoryDrillDown` via
`useTransactionManager`), the page now provides a `setTransactions`
function that proxies to `queryClient.setQueryData(<active-key>, …)`,
so optimistic edits write directly into the React Query cache and
survive until the next bridge invalidation refetches the truth.

### 6. `SyncStatus.jsx` reflects React Query activity

The TopBar refreshing pill now also lights up while React Query has
any in-flight fetch (`useIsFetching() > 0`), in addition to the Phase 1
`subscribeRevalidating` signal.

## Consumers converted

- `pages/SettingsPage.jsx` — `useCategories` + `useAccounts` (gated on
  the import modal being open, via `enabled`)
- `pages/CategoriesPage.jsx` — `useCategories`; mutations stay
  imperative
- `pages/ReportsPage.jsx` — `useTransactionsYTD` + `useCategories` +
  `usePendingReviewCount`; provides a `queryClient.setQueryData`-based
  `setAllTransactions` to its drill-down panel
- `pages/AccountsPage.jsx` — `useAccountBalances`,
  `useNetWorthHistory`, `useMaxProjectedDate`,
  `useUpcomingTransactions`; debounced `projectedToDate` becomes a
  query-key argument; `refreshAccounts()` removed
- `pages/TransactionsPage.jsx` — `useTransactions` /
  `useTransactionsForYear` (chosen by `viewMode`), `useCategories`,
  `useAccounts`, `useAccountBalances`; `setTransactions` becomes a
  `queryClient.setQueryData` proxy so the existing
  `useTransactionManager` optimistic pipeline keeps working;
  `dataLoadKey` for scroll-to-posted now bumps on
  `txQuery.dataUpdatedAt` change
- `components/budgets/BudgetForm.jsx` — `useCategories`
- `components/reports/CalendarView.jsx` — `useTransactions`
- `components/reports/PlanVsActual.jsx` — `useTransactions` +
  `useTransactionsYTD` (one with `enabled`) + `useCategories`; provides
  a query-cache `setRawTransactions` for its drill-down
- `components/accounts/CashflowChart.jsx` —
  `useAccountBalanceHistory`

## Skipped / deferred

- `components/budgets/AnnualBudgetTable.jsx` — owns heavy local
  optimistic state on the categories array (drag-reorder, inline edit).
  Conversion is risky and offers no immediate perf win; left on raw
  services.
- `components/reports/AnnualActualsTable.jsx` — calls
  `services/budgets.js` directly with year-wide aggregates that aren't
  yet exposed as a hook. Same reasoning.
- **`useMutation` adoption** — see §5 above; deferred indefinitely.
- **`@tanstack/react-query-devtools`** — not added; the network panel +
  the SyncStatus pill are sufficient diagnostics.
- **Cross-tab fanout via `BroadcastChannel`** — deferred. Listed as a
  future enhancement (would let one tab's mutation invalidate another
  tab's React Query cache). Today, each tab's bridge listens to its
  own `notifyTable` events only.

## Query-key conventions

All keys are arrays starting with the table name so the bridge can
invalidate a whole family with `[tableName]`:

- `[tableName]` — invalidates every variant of that table
- `[tableName, "list", filters?]` — generic list with optional filter object
- `[tableName, <id-or-scoping-key>, ...]` — scoped reads (e.g.
  `["budget_plans", month, year]`)

When you add a new query in `hooks/queries.js`, follow this convention
and the bridge will pick it up for free.

## Mutation contract

Any code that mutates a synced table must end up calling `notifyTable(t)`.
The current paths that satisfy this:

1. `putOffline(t, row)` — covers every offline-queued write.
2. Each `*Offline(...)` wrapper in `services/offlineAware.js` — covers
   every online write that succeeds against Supabase.

If you add a new mutation that bypasses both (e.g. talking to Supabase
directly without going through `offlineAware`), you must call
`notifyTable(t)` yourself — or call
`queryClient.invalidateQueries({ queryKey: [t] })` — to keep React
consumers in sync. `services/recurring.js` is the one current case
where this matters; `TransactionsPage.handleRecurringApplied` calls
`queryClient.invalidateQueries({ queryKey: ["transactions"] })`
after a manual recurring-template apply.
