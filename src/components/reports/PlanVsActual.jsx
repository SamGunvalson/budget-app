import { useEffect, useState, useCallback, useMemo } from 'react';
import MonthYearSelector from '../common/MonthYearSelector';
import BudgetAlert from '../common/BudgetAlert';
import PlanVsActualChart from './PlanVsActualChart';
import CategoryComparison from './CategoryComparison';
import CategoryDrillDown from './CategoryDrillDown';
import { getPlanVsActual, getPlanVsActualYTD } from '../../services/budgets';
import { getTransactionsOffline as getTransactions } from '../../services/offlineAware';
import { getTransactionsYTD } from '../../services/transactions';
import { getCategoriesOffline as getCategories } from '../../services/offlineAware';
import { formatCurrency, getMonthName } from '../../utils/helpers';
import useMonthYear from '../../hooks/useMonthYear';
import { overallAlert, flaggedCategories, formatVariance } from '../../utils/budgetCalculations';
import useThresholds from '../../hooks/useThresholds';

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
 * }} props
 */
export default function PlanVsActual({
  month: externalMonth,
  year: externalYear,
  viewMode = 'monthly',
  onMonthChange,
  showSelector = true,
}) {
  const isYTD = viewMode === 'ytd';
  const { month: ctxMonth, year: ctxYear, setMonthYear } = useMonthYear();

  // Use external values if provided, otherwise use context state
  const month = externalMonth ?? ctxMonth;
  const year = externalYear ?? ctxYear;

  const [data, setData] = useState({ categories: [], plannedIncome: 0, actualIncome: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Raw transactions + categories for drill-down
  const [rawTransactions, setRawTransactions] = useState([]);
  const [allCategories, setAllCategories] = useState([]);
  const [expandedCategoryId, setExpandedCategoryId] = useState(null);

  // User-configurable budget thresholds
  const { thresholds } = useThresholds();

  const handleMonthChange = (m, y) => {
    setMonthYear(m, y);
    onMonthChange?.(m, y);
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError('');
      setExpandedCategoryId(null);
      try {
        const planPromise = isYTD
          ? getPlanVsActualYTD({ year, throughMonth: month })
          : getPlanVsActual({ month, year });
        const txPromise = isYTD
          ? getTransactionsYTD({ year, throughMonth: month })
          : getTransactions({ month, year });

        const [result, txData, cats] = await Promise.all([
          planPromise,
          txPromise,
          getCategories(),
        ]);
        if (!cancelled) {
          setData(result);
          setRawTransactions(txData);
          setAllCategories(cats);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load plan vs actual data');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [month, year, isYTD]);

  // Derived summary stats — split income vs expense categories, hiding empty rows
  const categories = useMemo(
    () => (data.categories || []).filter((c) => c.planned > 0 || c.actual !== 0),
    [data.categories],
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
          categoryColor={catData?.categoryColor || '#A8A29E'}
          onClose={() => setExpandedCategoryId(null)}
          onDataChanged={() => {
            // Re-fetch plan data to refresh comparison after edits
            const planPromise = isYTD
              ? getPlanVsActualYTD({ year, throughMonth: month })
              : getPlanVsActual({ month, year });
            planPromise.then(setData).catch(() => {});
          }}
          setAllTransactions={setRawTransactions}
        />
      );
    },
    [rawTransactions, categories, allCategories, isYTD, month, year],
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
          <div className="grid grid-cols-3 gap-2 sm:gap-6">
            {/* Total Planned */}
            <div className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-3 sm:p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
              <div className="mb-1 sm:mb-3 flex items-center gap-3">
                <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-700">
                  <svg
                    className="h-5 w-5 text-stone-600 dark:text-stone-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
                    />
                  </svg>
                </div>
                <p className="text-xs sm:text-sm font-medium text-stone-500 dark:text-stone-400">
                  <span className="sm:hidden">Planned</span>
                  <span className="hidden sm:inline">Total Planned</span>
                </p>
              </div>
              <p className="text-xl sm:text-3xl font-bold text-stone-700 dark:text-stone-300">
                {formatCurrency(totalPlanned, 'USD', { hideCents: true })}
              </p>
            </div>

            {/* Total Actual */}
            <div
              className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-3 sm:p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50"
              style={{ animationDelay: '80ms' }}
            >
              <div className="mb-1 sm:mb-3 flex items-center gap-3">
                <div
                  className={`hidden sm:flex h-10 w-10 items-center justify-center rounded-xl ${
                    isOverBudget ? 'bg-red-100' : 'bg-amber-100'
                  }`}
                >
                  <svg
                    className={`h-5 w-5 ${isOverBudget ? 'text-red-600' : 'text-amber-600'}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
                    />
                  </svg>
                </div>
                <p className="text-xs sm:text-sm font-medium text-stone-500 dark:text-stone-400">
                  <span className="sm:hidden">Actual</span>
                  <span className="hidden sm:inline">Total Actual</span>
                </p>
              </div>
              <p
                className={`text-xl sm:text-3xl font-bold ${
                  isOverBudget ? 'text-red-600' : 'text-amber-600'
                }`}
              >
                {formatCurrency(totalActual, 'USD', { hideCents: true })}
              </p>
            </div>

            {/* Variance */}
            <div
              className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-3 sm:p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50"
              style={{ animationDelay: '160ms' }}
            >
              <div className="mb-1 sm:mb-3 flex items-center gap-3">
                <div
                  className={`hidden sm:flex h-10 w-10 items-center justify-center rounded-xl ${
                    isOverBudget ? 'bg-red-100' : 'bg-emerald-100'
                  }`}
                >
                  <svg
                    className={`h-5 w-5 ${isOverBudget ? 'text-red-600' : 'text-emerald-600'}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-4.5L16.5 16.5m0 0L12 12m4.5 4.5V3"
                    />
                  </svg>
                </div>
                <p className="text-xs sm:text-sm font-medium text-stone-500 dark:text-stone-400">Variance</p>
              </div>
              <p
                className={`text-xl sm:text-3xl font-bold ${
                  isOverBudget ? 'text-red-600' : 'text-emerald-600'
                }`}
              >
                {isOverBudget ? '+' : '-'}
                {formatCurrency(Math.abs(totalVariance), 'USD', { hideCents: true })}
              </p>
              <p className="mt-1 hidden sm:block text-xs text-stone-400 dark:text-stone-500">
                {isOverBudget
                  ? `${overall.pct}% of budget used — over by ${formatCurrency(Math.abs(totalVariance))}`
                  : totalPlanned > 0
                    ? `${overall.pct}% of budget used — ${formatCurrency(Math.abs(totalVariance))} remaining`
                    : isYTD ? 'No budgets set year to date' : 'No budget set for this month'}
              </p>
            </div>
          </div>

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
