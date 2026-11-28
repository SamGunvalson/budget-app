import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAnnualBudgetData, useCategories, useTransactionsForYears } from './queries';
import { isSettledTransaction } from '../utils/helpers';
import { isQueryUnavailable } from '../utils/queryState';
import { categoryMonthMatrix, withCurrentCategories, yearsForKeys } from '../utils/reportAggregations';

/**
 * Data shared by the client-computed Reports tabs (Overview, Categories,
 * Payees, Trends): settled transactions for every calendar year that `year`
 * or any key in `keyLists` falls in, their category × month matrix,
 * categories, and optionally the annual budget for `year`. Reads go through
 * the offline-capable hooks, so the tabs work offline like Annual Actuals.
 *
 * @param {{
 *   year: number,
 *   keyLists: string[][],   // every month key the caller will read
 *   asOf: string | null,    // isSettledTransaction cutoff; null counts every row
 *   withBudget?: boolean,
 * }} options
 */
export default function useReportData({ year, keyLists, asOf, withBudget = false }) {
  const queryClient = useQueryClient();
  const yearsKey = [...new Set([year, ...yearsForKeys(...keyLists)])].sort((a, b) => a - b).join(',');
  const years = useMemo(() => yearsKey.split(',').map(Number), [yearsKey]);

  const yearQueries = useTransactionsForYears(years);
  const budgetQuery = useAnnualBudgetData(year, { enabled: withBudget });
  const categoriesQuery = useCategories();
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  // useQueries returns a new array every render, so key the memo on when each
  // year's data last changed (optimistic setQueryData bumps it too).
  const dataVersion = yearQueries.map((q) => `${q.dataUpdatedAt}:${q.data ? 1 : 0}`).join(',');
  const allTransactions = useMemo(
    () => yearQueries.flatMap((q) => q.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataVersion tracks yearQueries' data
    [dataVersion],
  );
  // Current category names/colors, so Flow, the matrix and List agree right
  // after a recolor instead of waiting for the transaction queries to refetch.
  const settled = useMemo(
    () => withCurrentCategories(allTransactions.filter((t) => isSettledTransaction(t, asOf)), categories),
    [allTransactions, asOf, categories],
  );

  const matrix = useMemo(() => categoryMonthMatrix(settled), [settled]);

  // Optimistic edits from a drill-down. Its rows can span several loaded
  // years, so the updater runs on each year's cache. useTransactionManager's
  // updaters map/filter by transaction id, so rows from other years pass
  // through unchanged. A plain array (no updater) only replaces `year`.
  const setYearTransactions = useCallback((updater) => {
    if (typeof updater !== 'function') {
      queryClient.setQueryData(['transactions', 'year', year], updater);
      return;
    }
    for (const y of years) {
      queryClient.setQueryData(['transactions', 'year', y], (prev) => (prev ? updater(prev) : prev));
    }
  }, [queryClient, year, years]);

  const queries = [...yearQueries, categoriesQuery];
  if (withBudget) queries.push(budgetQuery);

  return {
    /** Every loaded row, unfiltered: the drill-down finds transfer legs here. */
    allTransactions,
    settled,
    matrix,
    categories,
    budget: budgetQuery.data,
    setYearTransactions,
    isLoading: queries.some((q) => q.isLoading),
    /** The first query with no usable data, for a DataUnavailable retry. */
    failed: queries.find((q) => isQueryUnavailable(q)) ?? null,
  };
}
