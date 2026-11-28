import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAnnualBudgetData, useCategories, useTransactionsForYear } from './queries';
import { isSettledTransaction } from '../utils/helpers';
import { isQueryUnavailable } from '../utils/queryState';
import { categoryMonthMatrix, yearsForKeys } from '../utils/reportAggregations';

/**
 * Data shared by the client-computed Reports tabs (Overview, Categories):
 * settled transactions for `year` (plus `year - 1` when any key in `keyLists`
 * falls there), their category × month matrix, categories, and optionally the
 * annual budget for `year`. Reads go through the offline-capable hooks, so the
 * tabs work offline like Annual Actuals.
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
  const needPrevYear = yearsForKeys(...keyLists).includes(year - 1);

  const currentQuery = useTransactionsForYear(year);
  const prevQuery = useTransactionsForYear(year - 1, { enabled: needPrevYear });
  const budgetQuery = useAnnualBudgetData(year, { enabled: withBudget });
  const categoriesQuery = useCategories();
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  const settled = useMemo(() => {
    const rows = needPrevYear
      ? [...(prevQuery.data ?? []), ...(currentQuery.data ?? [])]
      : currentQuery.data ?? [];
    return rows.filter((t) => isSettledTransaction(t, asOf));
  }, [currentQuery.data, prevQuery.data, needPrevYear, asOf]);

  const matrix = useMemo(() => categoryMonthMatrix(settled), [settled]);

  // Optimistic edits from a drill-down. Its rows can span both loaded years,
  // so the updater runs on each year's cache. useTransactionManager's
  // updaters map/filter by transaction id, so rows from the other year pass
  // through unchanged. A plain array (no updater) only replaces `year`.
  const setYearTransactions = useCallback((updater) => {
    if (typeof updater !== 'function') {
      queryClient.setQueryData(['transactions', 'year', year], updater);
      return;
    }
    const years = needPrevYear ? [year, year - 1] : [year];
    for (const y of years) {
      queryClient.setQueryData(['transactions', 'year', y], (prev) => (prev ? updater(prev) : prev));
    }
  }, [queryClient, year, needPrevYear]);

  const queries = [currentQuery, categoriesQuery];
  if (needPrevYear) queries.push(prevQuery);
  if (withBudget) queries.push(budgetQuery);

  return {
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
