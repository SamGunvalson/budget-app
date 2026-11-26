import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import MonthYearSelector from '../common/MonthYearSelector';
import BudgetAlert from '../common/BudgetAlert';
import StatCards from './StatCards';
import PlanVsActualChart from './PlanVsActualChart';
import CategoryComparison from './CategoryComparison';
import CategoryDrillDown from './CategoryDrillDown';
import {
  useTransactions,
  useTransactionsYTD,
  useCategories,
  usePlanVsActual,
  usePlanVsActualYTD,
} from '../../hooks/queries';
import { formatCurrency, getMonthName, isSettledTransaction } from '../../utils/helpers';
import useMonthYear from '../../hooks/useMonthYear';
import { overallAlert, flaggedCategories, formatVariance } from '../../utils/budgetCalculations';
import useThresholds from '../../hooks/useThresholds';
import { CATEGORY_FALLBACK_COLOR } from '../../constants/chartColors';
import DataUnavailable from '../common/DataUnavailable';
import { isQueryUnavailable } from '../../utils/queryState';

/**
 * Main "Plan vs Actual" comparison view.
 * Combines a grouped bar chart, summary stats, per-category breakdown,
 * and over-budget alerts into one cohesive report section.
 *
 * Can be used standalone or embedded inside ReportsPage.
 *
 * @param {{
 *   month?: number,
 *   year?: number,
 *   viewMode?: 'monthly' | 'ytd',
 *   onMonthChange?: (month: number, year: number) => void,
 *   showSelector?: boolean,
 *   asOf?: string | null,
 * }} props
 *
 * `asOf` (YYYY-MM-DD) limits actuals and drill-downs to posted transactions
 * dated on or before it; null/omitted counts every live transaction.
 */
export default function PlanVsActual({
  month: externalMonth,
  year: externalYear,
  viewMode = 'monthly',
  onMonthChange,
  showSelector = true,
  asOf = null,
}) {
  const isYTD = viewMode === 'ytd';
  const { month: ctxMonth, year: ctxYear, setMonthYear } = useMonthYear();

  // Use external values if provided, otherwise use context state
  const month = externalMonth ?? ctxMonth;
  const year = externalYear ?? ctxYear;

  const [expandedCategoryId, setExpandedCategoryId] = useState(null);

  // Plan-vs-actual aggregated server-side (Phase 3 RPC), exactly one of the
  // two hooks runs based on viewMode.  React Query handles loading state and
  // background invalidation when transactions or budget items mutate.
  const monthlyPvaQuery = usePlanVsActual(month, year, { enabled: !isYTD, asOf });
  const ytdPvaQuery = usePlanVsActualYTD(year, month, { enabled: isYTD, asOf });
  const pvaQuery = isYTD ? ytdPvaQuery : monthlyPvaQuery;
  // No aggregate (error with nothing cached): show "unavailable", never $0.
  const pvaUnavailable = isQueryUnavailable(pvaQuery);
  const data = pvaQuery.data ?? { categories: [], plannedIncome: 0, actualIncome: 0 };
  const isPlanLoading = pvaQuery.isLoading;
  // Shown by the unavailable panel instead of the generic error banner.
  const planError = pvaUnavailable ? '' : pvaQuery.error?.message || '';

  // Collapse drill-down whenever the period or view mode changes.  The
  // expanded state stops being meaningful for the new dataset, so we drop
  // it during render rather than in an effect (avoids a cascading render).
  const periodKey = `${year}-${month}-${isYTD ? 'ytd' : 'm'}`;
  const [drillKey, setDrillKey] = useState(periodKey);
  if (drillKey !== periodKey) {
    setDrillKey(periodKey);
    if (expandedCategoryId !== null) setExpandedCategoryId(null);
  }

  // Raw transactions + categories for drill-down (cached via react-query).
  const monthlyTxQuery = useTransactions({ month, year }, { enabled: !isYTD });
  const ytdTxQuery = useTransactionsYTD(year, month, { enabled: isYTD });
  const categoriesQuery = useCategories();
  const rawTransactions = useMemo(
    () => ((isYTD ? ytdTxQuery.data : monthlyTxQuery.data) ?? [])
      .filter((tx) => isSettledTransaction(tx, asOf)),
    [isYTD, ytdTxQuery.data, monthlyTxQuery.data, asOf],
  );
  const allCategories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const queryClient = useQueryClient();
  // Setter that mutates the active transactions query cache so optimistic
  // edits from useTransactionManager (inside CategoryDrillDown) survive
  // until the bridge invalidation re-runs the query.
  const setRawTransactions = useCallback((updater) => {
    const key = isYTD
      ? ["transactions", "ytd", year, month]
      : ["transactions", "list", { month, year, status: null }];
    queryClient.setQueryData(key, (prev) =>
      typeof updater === 'function' ? updater(prev ?? []) : updater,
    );
  }, [queryClient, isYTD, month, year]);
  const isLoading =
    isPlanLoading ||
    (isYTD ? ytdTxQuery.isLoading : monthlyTxQuery.isLoading) ||
    categoriesQuery.isLoading;
  const error =
    planError ||
    (isYTD ? ytdTxQuery.error?.message : monthlyTxQuery.error?.message) ||
    categoriesQuery.error?.message ||
    '';

  // User-configurable budget thresholds
  const { thresholds } = useThresholds();

  const handleMonthChange = (m, y) => {
    setMonthYear(m, y);
    onMonthChange?.(m, y);
  };

  // Derived summary stats — split income vs expense categories, hiding empty rows
  const categories = useMemo(
    () => {
      const activityIds = new Set(rawTransactions.map((tx) => tx.category_id));
      const archivedIds = new Set(allCategories.filter((c) => c.is_archived).map((c) => c.id));
      return (data.categories || [])
        .filter((c) => c.planned > 0 || c.actual !== 0 || activityIds.has(c.categoryId))
        .map((c) => archivedIds.has(c.categoryId)
          ? { ...c, categoryName: `${c.categoryName} (Archived)` } : c);
    },
    [data.categories, rawTransactions, allCategories],
  );
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.categoryType !== 'income'),
    [categories],
  );
  const totalPlanned = expenseCategories.reduce((sum, d) => sum + d.planned, 0);
  const totalActual = expenseCategories.reduce((sum, d) => sum + d.actual, 0);
  const totalVariance = totalActual - totalPlanned;
  const isOverBudget = totalVariance > 0;
  const overall = overallAlert(totalActual, totalPlanned, thresholds);

  // Income summary — derive from category data (actualIncome) or plan total (plannedIncome)
  const { plannedIncome = 0, actualIncome = 0 } = data;

  // Categories at risk (at or above warning threshold) — expenses only
  const flagged = flaggedCategories(expenseCategories, thresholds);
  const dangerCategories = flagged.filter((c) => c.alert.level === 'danger');
  const warningCategories = flagged.filter((c) => c.alert.level === 'warning');

  // Drill-down: toggle category expansion
  const handleCategoryClick = useCallback((categoryId) => {
    setExpandedCategoryId((prev) => (prev === categoryId ? null : categoryId));
  }, []);

  // Drill-down: filter transactions for expanded category
  const renderDrillDown = useCallback(
    (categoryId) => {
      const catData = categories.find((c) => c.categoryId === categoryId);

      const catTx = rawTransactions.filter((t) => {
        if (t.categories?.type === 'transfer') return false;
        const txCatId = t.category_id || 'uncategorized';
        return txCatId === categoryId;
      });

      return (
        <CategoryDrillDown
          transactions={catTx}
          categories={allCategories}
          categoryName={catData?.categoryName || 'Unknown'}
          categoryColor={catData?.categoryColor || CATEGORY_FALLBACK_COLOR}
          onClose={() => setExpandedCategoryId(null)}
          onDataChanged={() => {
            // Invalidate the PvA query so the panel rebuilds after edits.
            // The bridge usually does this when transactions mutate, but
            // calling it explicitly ensures the user sees fresh numbers
            // immediately even when an offline-only edit batched its
            // notifyTable.
            queryClient.invalidateQueries({
              queryKey: ['budget_items', isYTD ? 'planVsActualYTD' : 'planVsActual'],
              refetchType: 'active',
            });
          }}
          setAllTransactions={setRawTransactions}
        />
      );
    },
    [rawTransactions, categories, allCategories, isYTD, queryClient, setRawTransactions],
  );

  return (
    <div className="space-y-6">
      {/* Header with optional month selector */}
      {showSelector && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="animate-fade-in">
            <h2 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
              Plan vs Actual
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {isYTD
                ? `Jan – ${getMonthName(month)} ${year} budget comparison`
                : `${getMonthName(month)} ${year} budget comparison`}
            </p>
          </div>
          <MonthYearSelector month={month} year={year} onChange={handleMonthChange} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <span className="mr-1.5">⚠</span>
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-2 sm:gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50"
              />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
          <div className="h-48 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
        </div>
      ) : pvaUnavailable ? (
        <DataUnavailable
          eyebrow={isYTD ? 'Year to date' : `${getMonthName(month)} ${year}`}
          title="Budget comparison unavailable"
          message="Couldn't load planned and actual totals for this period, so no figures are shown."
          onRetry={() => pvaQuery.refetch()}
          retrying={pvaQuery.isFetching}
        />
      ) : (
        <>
          {/* Overall budget alert */}
          {totalPlanned > 0 && overall.level !== 'success' && (
            <BudgetAlert
              type={overall.level}
              title={overall.level === 'danger' ? 'Over Budget' : 'Approaching Budget Limit'}
              message={
                overall.level === 'danger'
                  ? `You've spent ${formatVariance(totalVariance).replace(' over budget', '')} more than planned ${isYTD ? 'year to date' : 'this month'} (${overall.pct}% of budget used).`
                  : `You've used ${overall.pct}% of your ${isYTD ? 'YTD' : 'monthly'} budget. ${formatVariance(totalVariance)}.`
              }
              actual={totalActual}
              planned={totalPlanned}
              varianceText={overall.varianceText}
            />
          )}

          {/* Per-category danger alerts (over 100%) */}
          {dangerCategories.length > 0 && (
            <BudgetAlert
              type="danger"
              title={`${dangerCategories.length} ${dangerCategories.length === 1 ? 'category' : 'categories'} over budget`}
              message={dangerCategories
                .map(
                  (c) =>
                    `${c.categoryName} (${c.alert.pct === Infinity ? '∞' : c.alert.pct}% — ${c.alert.varianceText})`,
                )
                .join(' · ')}
            />
          )}

          {/* Per-category warning alerts (80-99%) */}
          {warningCategories.length > 0 && (
            <BudgetAlert
              type="warning"
              title={`${warningCategories.length} ${warningCategories.length === 1 ? 'category is' : 'categories are'} approaching limit`}
              message={warningCategories
                .map(
                  (c) =>
                    `${c.categoryName} (${c.alert.pct}% used)`,
                )
                .join(' · ')}
            />
          )}

          {/* Summary stat cards */}
          <StatCards
            cards={[
              {
                label: isOverBudget ? 'Over budget' : 'Left in budget',
                value: formatCurrency(Math.abs(totalVariance), 'USD', { hideCents: true }),
                sub: totalPlanned > 0
                  ? `${overall.pct}% of budget used`
                  : isYTD ? 'No budgets set year to date' : 'No budget set for this month',
                negative: isOverBudget,
              },
              { label: 'Planned spending', value: formatCurrency(totalPlanned, 'USD', { hideCents: true }) },
              { label: 'Actual spending', value: formatCurrency(totalActual, 'USD', { hideCents: true }) },
            ]}
          />

          {/* Bar chart — summary: Income / Expenses / NET */}
          <PlanVsActualChart
            plannedIncome={plannedIncome}
            actualIncome={actualIncome}
            plannedExpenses={totalPlanned}
            actualExpenses={totalActual}
          />

          {/* Category comparison table — includes income categories */}
          <CategoryComparison
            data={categories}
            onCategoryClick={handleCategoryClick}
            expandedCategoryId={expandedCategoryId}
            renderDrillDown={renderDrillDown}
            thresholds={thresholds}
          />
        </>
      )}
    </div>
  );
}
