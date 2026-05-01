# Phase 3 — Server-side aggregations

**Status:** ✅ Shipped
**Builds on:** Phase 1 (cache-first reads) and Phase 2 (React Query + bridge).
**Goal:** Push every report-style aggregation that previously required pulling
the full transaction history into the browser down into Postgres, so the
client only ever pays for the aggregated payload.

## Motivation

Phases 1 and 2 made navigation feel instant by serving Dexie cache for
single-table list views. The remaining slow paths were the **derived**
screens — net-worth history, plan-vs-actual, spending trends, account
balance projection, the year selector — which all called paginated
`select` against `transactions` and folded the rows in JS.

For an account with ~10k transactions:

- `getNetWorthHistory` paged through every row to build per-month running
  balances per account (≈300 KB of JSON over the wire, ~80 ms of JS folding).
- `getPlanVsActual` re-pulled an entire month's transactions into the browser
  just to sum them by category.
- `getMonthlyTrend` / `getYearlyTrend` did the same thing for 6/12/24 months.
- `getAccountBalanceHistory` re-paged for every account-detail open.
- `getTransactionYears` ordered the entire table by date just to pluck the
  earliest year.

All of those payloads are now collapsed to ≤a few KB by the database.

## What shipped

### 1. SQL: aggregation RPCs + indexes

Single migration script: `sql_scripts/supabase_phase3_aggregations.sql`
(idempotent — safe to re-run).

| Function                                                            | Returns                                                                                   | Replaces (client-side)                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| `get_transaction_years()`                                           | `int[]` — earliest year .. current+1                                                      | full-table scan ordered by date, take first  |
| `get_account_balances(p_projected_to_date date)`                    | one row per account with `transaction_net`, `balance`, `pending_net`, `projected_balance` | per-account paginated balance walk           |
| `get_net_worth_history(p_projected_to_date date)`                   | `jsonb { history, projectedFuture }` of monthly net-worth points                          | recursive month walk in JS over all txns     |
| `get_account_balance_history(p_account_ids uuid[], p_start, p_end)` | `(date, balances jsonb, total bigint)` rows                                               | per-account daily fold in JS                 |
| `get_plan_vs_actual(p_month, p_year)`                               | `jsonb { categories, plannedIncome, actualIncome }`                                       | merge of `budget_items` + monthly txns in JS |
| `get_plan_vs_actual_ytd(p_year, p_through_month)`                   | same shape, summed across YTD                                                             | same, over a wider window                    |
| `get_monthly_spending_trend(p_months, p_end_month, p_end_year)`     | `(key, label, year, month, spent, income, tx_count)`                                      | `aggregateByMonth` over paginated raw txns   |
| `get_yearly_spending_trend(p_years, p_end_month, p_end_year)`       | `(year, spent, income, tx_count)`                                                         | `aggregateByYear` over paginated raw txns    |

All functions are `STABLE`, declared `SECURITY INVOKER`, and pin
`SET search_path = public`. They filter by `auth.uid()` so existing RLS
policies remain the source of truth — no policy duplication in SQL.

The accounting rules (true income vs income-debit vs spending-credit, transfer
exclusion) are encoded once per RPC using `CASE` expressions matching the JS
helpers in `src/utils/helpers.js`.

Two new indexes back the hot access patterns:

```sql
CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions (user_id, account_id, transaction_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_category_date
  ON transactions (user_id, category_id, transaction_date)
  WHERE deleted_at IS NULL;
```

The partial predicate keeps both indexes lean (soft-deleted rows are excluded
from every aggregation anyway).

### 2. Service layer thinned out

These service functions now do nothing but call the matching RPC and coerce
the numeric fields with `Number()` (Postgres `bigint` arrives as strings):

| File                           | Function                                                               |
| ------------------------------ | ---------------------------------------------------------------------- |
| `src/services/accounts.js`     | `getAccountBalances`, `getNetWorthHistory`, `getAccountBalanceHistory` |
| `src/services/budgets.js`      | `getPlanVsActual`, `getPlanVsActualYTD`                                |
| `src/services/transactions.js` | `getTransactionYears`                                                  |
| `src/services/analytics.js`    | `getMonthlySpendingTrend` (new), `getYearlySpendingTrend` (new)        |

Roughly **~450 lines of in-browser folding code were deleted**, including the
recursive net-worth walk, per-account balance pagination, and the trend-window
raw fetchers (`getTrendTransactions`, `getYearlyTrendTransactions` — now
removed entirely; their consumers use the RPC-backed helpers above instead).

### 3. Offline fallback path

Every Phase 3 call goes through a thin wrapper in
`src/services/offlineAware.js` that follows this pattern:

```text
tryOnline → RPC          ← preferred; returns server aggregate
   └── on offline/error → run the same accounting rules against Dexie
```

The wrappers added (~280 lines, all in the new "PHASE 3" section at the bottom
of `offlineAware.js`):

- `getPlanVsActualOffline` / `getPlanVsActualYTDOffline` — read
  `db.budget_plans`, `db.budget_items`, `db.categories`, `db.transactions` and
  fold them with the same `isTrueIncome` / `isSpendingCredit` / `isIncomeDebit`
  predicates the SQL `CASE` clauses encode.
- `getMonthlySpendingTrendOffline` — joins `db.transactions` with cached
  categories, then aggregates with the same window helper.
- `getYearlySpendingTrendOffline` — inline yearly fold over the same join.
- `getTransactionYearsOffline` — scans Dexie for the earliest year.

The fallbacks are not as fast as the RPCs (we're back to the in-browser fold)
but they are correct, RLS is moot offline, and the cache is what's available.
The fast path remains the default whenever the network is reachable.

### 4. React Query hooks

Five new hooks in `src/hooks/queries.js`:

| Hook                           | Query key                                                         |
| ------------------------------ | ----------------------------------------------------------------- |
| `usePlanVsActual(m, y)`        | `['budget_items', 'planVsActual', { month, year }]`               |
| `usePlanVsActualYTD(y, m)`     | `['budget_items', 'planVsActualYTD', { year, throughMonth }]`     |
| `useMonthlySpendingTrend({…})` | `['transactions', 'monthlyTrend', { months, endMonth, endYear }]` |
| `useYearlySpendingTrend({…})`  | `['transactions', 'yearlyTrend', { years, endMonth, endYear }]`   |
| `useTransactionYears()`        | `['transactions', 'years']`                                       |

All keys nest under an existing **bridged** table name, so the Phase 2
`services/queryBridge.js` invalidator already refreshes them when those tables
change. The bridge gained two extra explicit invalidations so that
**`transactions`** mutations also bust the plan-vs-actual cache (whose primary
key namespace is `budget_items`):

```js
queryClient.invalidateQueries({ queryKey: ["budget_items", "planVsActual"] });
queryClient.invalidateQueries({
  queryKey: ["budget_items", "planVsActualYTD"],
});
```

### 5. Consumers migrated

- `src/components/reports/PlanVsActual.jsx` — dropped its imperative
  `loadPlan()` `useEffect` + `data/isPlanLoading/planError` state. Now just
  selects between `usePlanVsActual` and `usePlanVsActualYTD` based on
  `viewMode`. The drill-down's `onDataChanged` calls
  `queryClient.invalidateQueries` instead of re-fetching by hand.
- `src/pages/ReportsPage.jsx` — dropped its trend-loading effect and the now-
  removed `getTrendTransactions/getYearlyTrendTransactions/aggregateByMonth`
  imports. `useMonthlySpendingTrend({ months: 6 | 12 | 24, … })` covers all
  three range modes (`6m`, `12m`, `yoy`) with a single hook.
- `src/hooks/useAvailableYears.js` — wraps `useTransactionYears()` (still
  returns the same `{ years, isLoading }` API its callers depend on).

## Deployment

1. Open the Supabase SQL Editor on the target project.
2. Paste & run `sql_scripts/supabase_phase3_aggregations.sql`. It is fully
   idempotent (`CREATE OR REPLACE`, `CREATE INDEX IF NOT EXISTS`, `DROP
FUNCTION IF EXISTS` for any signature changes).
3. Deploy the frontend. No env-var changes; no migrations required on the app
   side.

There is no down-migration script — to roll back, redeploy the previous
frontend bundle (the RPCs in the database are harmless to leave in place).

## Verification

The script ends with a `SELECT proname …` against `pg_proc` that lists every
function it created — confirms a clean install in one statement.

After deployment:

- `Reports → Plan vs Actual` should render in a single network round-trip
  (one RPC) with no second pass for transaction details unless a category is
  drilled into.
- `Reports → Trends` should fetch ≤a few KB regardless of the range button
  selected (`6m`, `12m`, `yoy=24m`).
- `Accounts` page balances and net-worth chart should arrive in one RPC each.
- Toggling offline (DevTools → Network → Offline) should still render the
  same screens from Dexie via the `*Offline` wrappers.

## What's deliberately not done here

- **Materialised views.** The aggregations are fast enough on live data with
  the new indexes; pre-materialising would re-introduce a freshness window
  Phase 1/2 spent effort eliminating.
- **Drill-down RPCs.** The drill-down panel still loads raw transactions for
  one category — that's already cached by Phase 2 and is not a hotspot.
- **Trend caching at the RPC layer.** `STABLE` lets PostgREST/Supabase cache
  on the connection but we don't add app-level caching beyond React Query's
  default `staleTime`. Revisit if the dashboard becomes the slow path again.
