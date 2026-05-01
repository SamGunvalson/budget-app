/**
 * React Query hooks for every cache-first read in the app (Phase 2).
 *
 * Each hook is a thin wrapper around the corresponding `*Offline` function in
 * `services/offlineAware.js`. The query key is always `[tableName, ...specifics]`
 * so the bridge in `services/queryBridge.js` can broad-invalidate everything
 * keyed on a table after a Dexie change.
 *
 * Hook conventions
 * ────────────────
 *  - **`enabled`** — every hook accepts an `enabled` flag (defaults to `true`).
 *    Use it to gate queries on data that isn't ready yet (e.g. don't fetch
 *    `useBudgetItems` until you have a `budgetPlanId`).
 *  - **Default values** — `data` is `undefined` while a query is loading.
 *    Hook docs note the "natural empty" for each shape so call sites can
 *    `useTransactions(filters).data ?? []`.
 *  - **Mutations are NOT in this file.** Mutations remain imperative calls to
 *    `services/offlineAware.js`; they rely on `notifyTable` (fired inside the
 *    mutation wrappers) to invalidate matching queries via the bridge.
 *
 * Why one big file: each hook is ~10 lines and they share a tight invariant
 * (the query-key convention). One file makes it easy to grep for usage and
 * to keep keys aligned across pages.
 */
import { useQuery } from "@tanstack/react-query";
import {
  // transactions
  getTransactionsOffline,
  getTransactionsYTDOffline,
  getTransactionsForYearOffline,
  getPendingReviewCountOffline,
  getTransactionYearsOffline,
  // accounts
  getAccountsOffline,
  getAccountBalancesOffline,
  getNetWorthHistoryOffline,
  getMaxProjectedDateOffline,
  getAccountBalanceHistoryOffline,
  getUpcomingTransactionsOffline,
  // categories
  getCategoriesOffline,
  // user preferences
  getUserPreferenceOffline,
  // budgets
  getBudgetPlanOffline,
  getBudgetItemsOffline,
  getPlanVsActualOffline,
  getPlanVsActualYTDOffline,
  // recurring
  getTemplatesForAccountOffline,
  // analytics
  getMonthlySpendingTrendOffline,
  getYearlySpendingTrendOffline,
} from "../services/offlineAware";

// ── Transactions ──────────────────────────────────────────────────────────

/**
 * Transactions for a given month/year (or `viewMode === 'yearly'` via
 * `useTransactionsForYear`). Shape matches `services/transactions.js#getTransactions`
 * — array of rows joined with `categories` and `accounts`.
 */
export function useTransactions(filters = {}, { enabled = true } = {}) {
  const { month, year, status } = filters;
  return useQuery({
    queryKey: [
      "transactions",
      "list",
      { month: month ?? null, year: year ?? null, status: status ?? null },
    ],
    queryFn: () => getTransactionsOffline(filters),
    enabled,
  });
}

/** Transactions for an entire calendar year. */
export function useTransactionsForYear(year, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["transactions", "year", year],
    queryFn: () => getTransactionsForYearOffline({ year }),
    enabled: enabled && year != null,
  });
}

/** Year-to-date transactions through `throughMonth` (1–12). */
export function useTransactionsYTD(
  year,
  throughMonth,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: ["transactions", "ytd", year, throughMonth],
    queryFn: () => getTransactionsYTDOffline({ year, throughMonth }),
    enabled: enabled && year != null && throughMonth != null,
  });
}

/** Number of `status === 'pending'` transactions for the current user. */
export function usePendingReviewCount({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["transactions", "pendingReviewCount"],
    queryFn: () => getPendingReviewCountOffline(),
    enabled,
  });
}

// ── Accounts ──────────────────────────────────────────────────────────────

export function useAccounts({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["accounts", "list"],
    queryFn: () => getAccountsOffline(),
    enabled,
  });
}

/**
 * Account balances enriched with `balance` / `pending_net` / `projected_balance`
 * / `transaction_net` / `is_asset`. Depends on both `accounts` and
 * `transactions`; the bridge invalidates after either changes.
 */
export function useAccountBalances(
  { projectedToDate } = {},
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: [
      "accounts",
      "balances",
      { projectedToDate: projectedToDate ?? null },
    ],
    queryFn: () => getAccountBalancesOffline({ projectedToDate }),
    enabled,
  });
}

export function useNetWorthHistory(
  { projectedToDate } = {},
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: [
      "accounts",
      "netWorthHistory",
      { projectedToDate: projectedToDate ?? null },
    ],
    queryFn: () => getNetWorthHistoryOffline({ projectedToDate }),
    enabled,
  });
}

export function useMaxProjectedDate({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["accounts", "maxProjectedDate"],
    queryFn: () => getMaxProjectedDateOffline(),
    enabled,
  });
}

export function useAccountBalanceHistory(opts, { enabled = true } = {}) {
  const { accountIds, startDate, endDate } = opts ?? {};
  return useQuery({
    queryKey: [
      "accounts",
      "balanceHistory",
      { accountIds: accountIds ?? null, startDate, endDate },
    ],
    queryFn: () => getAccountBalanceHistoryOffline(opts),
    enabled: enabled && Array.isArray(accountIds) && accountIds.length > 0,
  });
}

export function useUpcomingTransactions(opts, { enabled = true } = {}) {
  const { accountIds } = opts ?? {};
  return useQuery({
    queryKey: ["transactions", "upcoming", { accountIds: accountIds ?? null }],
    queryFn: () => getUpcomingTransactionsOffline(opts),
    enabled: enabled && Array.isArray(accountIds) && accountIds.length > 0,
  });
}

// ── Categories ────────────────────────────────────────────────────────────

export function useCategories({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["categories", "list"],
    queryFn: () => getCategoriesOffline(),
    enabled,
  });
}

// ── User preferences ──────────────────────────────────────────────────────

/**
 * Single user preference value. The query key includes the preference key so
 * each preference gets its own cache entry; the bridge invalidates *all*
 * `user_preferences:*` queries when the table changes (cheap — usually a
 * handful of keys per user).
 */
export function useUserPreference(key, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["user_preferences", key],
    queryFn: () => getUserPreferenceOffline(key),
    enabled: enabled && !!key,
  });
}

// ── Budgets ───────────────────────────────────────────────────────────────

export function useBudgetPlan(month, year, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["budget_plans", { month, year }],
    queryFn: () => getBudgetPlanOffline(month, year),
    enabled: enabled && month != null && year != null,
  });
}

export function useBudgetItems(budgetPlanId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["budget_items", budgetPlanId],
    queryFn: () => getBudgetItemsOffline(budgetPlanId),
    enabled: enabled && !!budgetPlanId,
  });
}

/**
 * Plan-vs-Actual aggregated server-side via the `get_plan_vs_actual` RPC
 * (Phase 3).  Returns `{ categories, plannedIncome, actualIncome }`.  The
 * query key is keyed under `budget_items` so any budget mutation
 * invalidates it automatically through the bridge.
 */
export function usePlanVsActual(month, year, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["budget_items", "planVsActual", { month, year }],
    queryFn: () => getPlanVsActualOffline({ month, year }),
    enabled: enabled && month != null && year != null,
  });
}

/**
 * Plan-vs-Actual YTD via the `get_plan_vs_actual_ytd` RPC (Phase 3).
 */
export function usePlanVsActualYTD(
  year,
  throughMonth,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: ["budget_items", "planVsActualYTD", { year, throughMonth }],
    queryFn: () => getPlanVsActualYTDOffline({ year, throughMonth }),
    enabled: enabled && year != null && throughMonth != null,
  });
}

// ── Recurring templates ───────────────────────────────────────────────────

export function useTemplatesForAccount(accountId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["recurring_templates", "forAccount", accountId],
    queryFn: () => getTemplatesForAccountOffline(accountId),
    enabled: enabled && !!accountId,
  });
}

// ── Analytics: server-side spending trends (Phase 3) ──────────────────────

/**
 * Pre-aggregated monthly spending trend via the
 * `get_monthly_spending_trend` Postgres RPC.  Returns rows shaped like the
 * old client-side `aggregateByMonth` output so existing chart components
 * keep working unchanged.
 */
export function useMonthlySpendingTrend(opts, { enabled = true } = {}) {
  const { months, endMonth, endYear } = opts ?? {};
  return useQuery({
    queryKey: [
      "transactions",
      "monthlyTrend",
      {
        months: months ?? null,
        endMonth: endMonth ?? null,
        endYear: endYear ?? null,
      },
    ],
    queryFn: () => getMonthlySpendingTrendOffline(opts),
    enabled,
  });
}

/**
 * Pre-aggregated yearly spending trend via the `get_yearly_spending_trend`
 * Postgres RPC.  Returns rows shaped like the old `aggregateByYear` output.
 */
export function useYearlySpendingTrend(opts, { enabled = true } = {}) {
  const { years, endMonth, endYear } = opts ?? {};
  return useQuery({
    queryKey: [
      "transactions",
      "yearlyTrend",
      {
        years: years ?? null,
        endMonth: endMonth ?? null,
        endYear: endYear ?? null,
      },
    ],
    queryFn: () => getYearlySpendingTrendOffline(opts),
    enabled,
  });
}

/**
 * Distinct transaction years (earliest → currentYear+1) via the
 * `get_transaction_years` RPC.  Used by year-scoped pickers.
 */
export function useTransactionYears({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["transactions", "years"],
    queryFn: () => getTransactionYearsOffline(),
    enabled,
  });
}
