import { useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import TopBar from '../components/common/TopBar';
import MonthYearSelector from '../components/common/MonthYearSelector';
import MonthlyStats from '../components/reports/MonthlyStats';
import CategoryChart from '../components/reports/CategoryChart';
import CategoryDrillDown from '../components/reports/CategoryDrillDown';
// Phase 5: defer recharts-bound charts until the user opens those tabs.
// Each lazy import becomes its own JS chunk; they pull in `recharts` only
// when first rendered, keeping the Reports route's first-paint bundle small.
const PlanVsActual = lazy(() => import('../components/reports/PlanVsActual'));
const TrendChart = lazy(() => import('../components/reports/TrendChart'));
import TrendSummary from '../components/reports/TrendSummary';
import {
  useTransactionsYTD,
  usePendingReviewCount,
  useCategories,
  useMonthlySpendingTrend,
} from '../hooks/queries';
import { computeTrendSummary } from '../services/analytics';
import { getMonthName, isTrueIncome, isSpendingCredit, isIncomeDebit } from '../utils/helpers';
import useMonthYear from '../hooks/useMonthYear';
import useSessionState from '../hooks/useSessionState';
import AnnualActualsTable from '../components/reports/AnnualActualsTable';
import CalendarView from '../components/reports/CalendarView';

// Skeleton placeholder shown while a lazy chart chunk is downloading.
function ChartFallback() {
  return (
    <div className="h-72 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
  );
}

export default function ReportsPage() {
  const { month, year, setMonthYear } = useMonthYear();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useSessionState('reportsViewMode', 'monthly'); // 'monthly' | 'ytd'
  // 'summary' | 'planVsActual' | 'trends' | 'annualActuals'
  // 'summary' | 'planVsActual' | 'trends' | 'annualActuals' | 'calendar'
  const [activeView, setActiveView] = useSessionState('reportsActiveView', 'summary');

  // Trend-specific state — owned here so TrendSummary stays in sync
  const [trendRange, setTrendRange] = useSessionState('reportsTrendRange', '6m'); // '6m' | '12m' | 'yoy'

  // Drill-down state: { name: string, type: 'income' | 'expense' } or null
  const [expandedChart, setExpandedChart] = useState(null);

  // Raw transaction & category data for drill-down + pending count.
  // react-query (Phase 2) handles loading + auto-refresh on table changes.
  const ytdQuery = useTransactionsYTD(year, month);
  const categoriesQuery = useCategories();
  const pendingQuery = usePendingReviewCount();
  const allTransactions = useMemo(() => ytdQuery.data ?? [], [ytdQuery.data]);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const pendingReviewCount = pendingQuery.data ?? 0;
  const isLoading =
    ytdQuery.isLoading || categoriesQuery.isLoading || pendingQuery.isLoading;
  const error =
    ytdQuery.error?.message ||
    categoriesQuery.error?.message ||
    pendingQuery.error?.message ||
    '';

  // Setter that applies optimistic updates to the YTD transactions query cache.
  // Accepts either a new array or an updater function (matching React setState).
  const setAllTransactions = useCallback((updater) => {
    queryClient.setQueryData(
      ["transactions", "ytd", year, month],
      (prev) => (typeof updater === 'function' ? updater(prev ?? []) : updater),
    );
  }, [queryClient, year, month]);

  const handleMonthChange = (m, y) => {
    setMonthYear(m, y);
  };

  useEffect(() => { document.title = 'Budget App | Reports'; }, []);

  // Reset drill-down when the selected period changes.  We use a render-time
  // transient state comparison instead of an effect to avoid the cascading
  // render that `setState` inside `useEffect` would cause.
  const [periodKey, setPeriodKey] = useState(`${year}-${month}`);
  if (periodKey !== `${year}-${month}`) {
    setPeriodKey(`${year}-${month}`);
    if (expandedChart !== null) setExpandedChart(null);
  }

  // Derive all report data from raw transactions (so edits propagate)
  const reportData = useMemo(() => {
    const inSelectedMonth = (t) => {
      const d = new Date(t.transaction_date);
      return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
    };

    let monthlyInc = 0, monthlyExp = 0;
    let ytdInc = 0, ytdExp = 0;
    const incomeMap = {};
    const expenseMap = {};
    const ytdIncomeMap = {};
    const ytdExpenseMap = {};

    for (const t of allTransactions) {
      if (t.categories?.type === 'transfer') continue;

      const catId = t.category_id || 'uncategorized';
      const catName = t.categories?.name || 'Uncategorized';
      const catColor = t.categories?.color || '#A8A29E';

      if (isTrueIncome(t)) {
        ytdInc += t.amount;
        if (!ytdIncomeMap[catId]) ytdIncomeMap[catId] = { name: catName, color: catColor, valueCents: 0, categoryId: catId };
        ytdIncomeMap[catId].valueCents += t.amount;
      } else if (isIncomeDebit(t)) {
        // Debit in an income category — reduce that category's income total
        ytdInc -= t.amount;
        if (!ytdIncomeMap[catId]) ytdIncomeMap[catId] = { name: catName, color: catColor, valueCents: 0, categoryId: catId };
        ytdIncomeMap[catId].valueCents -= t.amount;
      } else if (isSpendingCredit(t)) {
        // Credit in a spending category — reduce that category's expense total
        ytdExp -= t.amount;
        if (!ytdExpenseMap[catId]) ytdExpenseMap[catId] = { name: catName, color: catColor, valueCents: 0, categoryId: catId };
        ytdExpenseMap[catId].valueCents -= t.amount;
      } else {
        ytdExp += t.amount;
        if (!ytdExpenseMap[catId]) ytdExpenseMap[catId] = { name: catName, color: catColor, valueCents: 0, categoryId: catId };
        ytdExpenseMap[catId].valueCents += t.amount;
      }

      if (inSelectedMonth(t)) {
        if (isTrueIncome(t)) {
          monthlyInc += t.amount;
          if (!incomeMap[catId]) incomeMap[catId] = { name: catName, color: catColor, valueCents: 0, categoryId: catId };
          incomeMap[catId].valueCents += t.amount;
        } else if (isIncomeDebit(t)) {
          // Debit in an income category — reduce that category's income total
          monthlyInc -= t.amount;
          if (!incomeMap[catId]) incomeMap[catId] = { name: catName, color: catColor, valueCents: 0, categoryId: catId };
          incomeMap[catId].valueCents -= t.amount;
        } else if (isSpendingCredit(t)) {
          monthlyExp -= t.amount;
          if (!expenseMap[catId]) expenseMap[catId] = { name: catName, color: catColor, valueCents: 0, categoryId: catId };
          expenseMap[catId].valueCents -= t.amount;
        } else {
          monthlyExp += t.amount;
          if (!expenseMap[catId]) expenseMap[catId] = { name: catName, color: catColor, valueCents: 0, categoryId: catId };
          expenseMap[catId].valueCents += t.amount;
        }
      }
    }

    const sortDesc = (map) => Object.values(map).sort((a, b) => b.valueCents - a.valueCents);

    return {
      income: monthlyInc,
      expenses: monthlyExp,
      ytdIncome: ytdInc,
      ytdExpenses: ytdExp,
      incomeCategoryData: sortDesc(incomeMap),
      expenseCategoryData: sortDesc(expenseMap),
      ytdIncomeCategoryData: sortDesc(ytdIncomeMap),
      ytdExpenseCategoryData: sortDesc(ytdExpenseMap),
    };
  }, [allTransactions, month, year]);

  // Trend data: backed by Phase 3 server-side aggregation RPCs via React
  // Query.  All three ranges return monthly buckets (yoy = 24 months) so
  // TrendChart and computeTrendSummary share a single shape.
  const trendMonths = trendRange === 'yoy' ? 24 : trendRange === '12m' ? 12 : 6;
  const trendQuery = useMonthlySpendingTrend({
    months: trendMonths,
    endMonth: month,
    endYear: year,
  });
  const trendMonthlyData = useMemo(() => trendQuery.data ?? [], [trendQuery.data]);
  const trendLoading = trendQuery.isLoading;
  const trendError = trendQuery.error?.message || '';

  // Trend summary derived from the active range's monthly data
  const trendSummary = useMemo(
    () => computeTrendSummary(trendMonthlyData),
    [trendMonthlyData],
  );

  // ---------- Drill-down helpers ----------

  // Toggle category expansion on a chart (income or expense)
  const handleChartCategoryClick = useCallback(
    (categoryName, chartType) => {
      setExpandedChart((prev) => {
        if (prev?.name === categoryName && prev?.type === chartType) return null;
        return { name: categoryName, type: chartType };
      });
    },
    [],
  );

  // Filter transactions for the expanded category
  const getDrillDownTransactions = useCallback(
    (categoryName, isIncome) => {
      // Find categoryId by name from the chart data
      const chartData = isIncome
        ? (viewMode === 'ytd' ? reportData.ytdIncomeCategoryData : reportData.incomeCategoryData)
        : (viewMode === 'ytd' ? reportData.ytdExpenseCategoryData : reportData.expenseCategoryData);
      const entry = chartData.find((d) => d.name === categoryName);
      const categoryId = entry?.categoryId;

      const inSelectedMonth = (t) => {
        const d = new Date(t.transaction_date);
        return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
      };

      return allTransactions.filter((t) => {
        if (t.categories?.type === 'transfer') return false;
        // Match income/expense — spending credits belong with expenses, not income
        const txBelongsToIncome = isTrueIncome(t) || isIncomeDebit(t);
        if (isIncome && !txBelongsToIncome) return false;
        if (!isIncome && txBelongsToIncome) return false;
        // Match category
        const txCatId = t.category_id || 'uncategorized';
        if (txCatId !== categoryId) return false;
        // Match time range
        if (viewMode === 'monthly' && !inSelectedMonth(t)) return false;
        return true;
      });
    },
    [allTransactions, viewMode, month, year, reportData],
  );

  // Render function passed to CategoryChart
  const renderChartDrillDown = useCallback(
    (categoryName, chartType) => {
      const isIncome = chartType === 'income';
      const txs = getDrillDownTransactions(categoryName, isIncome);
      const chartData = isIncome
        ? (viewMode === 'ytd' ? reportData.ytdIncomeCategoryData : reportData.incomeCategoryData)
        : (viewMode === 'ytd' ? reportData.ytdExpenseCategoryData : reportData.expenseCategoryData);
      const entry = chartData.find((d) => d.name === categoryName);

      return (
        <CategoryDrillDown
          transactions={txs}
          categories={categories}
          categoryName={categoryName}
          categoryColor={entry?.color || '#A8A29E'}
          onClose={() => setExpandedChart(null)}
          onDataChanged={() => {
            // allTransactions state is already updated by setAllTransactions
            // in the hook — useMemo on reportData will recompute automatically
          }}
          setAllTransactions={setAllTransactions}
        />
      );
    },
    [getDrillDownTransactions, categories, viewMode, reportData, setAllTransactions],
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <TopBar pageName="Reports" />

      {/* Content */}
      <div className={`mx-auto px-4 py-8 sm:px-6 ${activeView === 'annualActuals' || activeView === 'calendar' ? 'max-w-full' : 'max-w-6xl'}`}>
        {/* Header row */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="animate-fade-in">
            <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              {activeView === 'calendar'
                ? 'Transaction Calendar'
                : activeView === 'annualActuals'
                  ? 'Annual Actuals'
                  : activeView === 'trends'
                    ? 'Spending Trends'
                    : activeView === 'planVsActual'
                      ? 'Plan vs Actual'
                      : viewMode === 'monthly'
                        ? 'Monthly Summary'
                        : 'YTD Summary'}
            </h1>
            <p className="mt-1 text-base text-stone-500 dark:text-stone-400">
              {activeView === 'calendar'
                ? `${getMonthName(month)} ${year} daily view`
                : activeView === 'annualActuals'
                  ? `${year} actual spending by category`
                  : activeView === 'trends'
                    ? 'Track your spending patterns over time'
                    : activeView === 'planVsActual'
                      ? (viewMode === 'ytd'
                          ? `Jan \u2013 ${getMonthName(month)} ${year} budget comparison`
                          : `${getMonthName(month)} ${year} budget comparison`)
                      : viewMode === 'monthly'
                        ? `${getMonthName(month)} ${year} overview`
                        : `Jan \u2013 ${getMonthName(month)} ${year} overview`}
            </p>
            {pendingReviewCount > 0 && (
              <Link
                to="/app/transactions"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold text-white">
                  {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                </span>
                Needs Review
              </Link>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* Unified view tab bar */}
            <div className="inline-flex rounded-xl border border-stone-200/60 bg-white p-1 shadow-sm dark:border-stone-700/60 dark:bg-stone-800">
              {[
                { id: 'summary',       label: 'Summary',        shortLabel: 'Summary', activeClass: 'bg-amber-500 text-white shadow-md shadow-amber-200/50' },
                { id: 'planVsActual',  label: 'Plan vs Actual', shortLabel: 'Plan',    activeClass: 'bg-emerald-500 text-white shadow-md shadow-emerald-200/50' },
                { id: 'trends',        label: 'Trends',         shortLabel: 'Trends',  activeClass: 'bg-sky-500 text-white shadow-md shadow-sky-200/50' },
                { id: 'annualActuals', label: 'Annual Actuals', shortLabel: 'Annual',  activeClass: 'bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-md shadow-violet-200/50 dark:shadow-violet-900/30' },
                { id: 'calendar',      label: 'Calendar',       shortLabel: 'Cal',     activeClass: 'bg-rose-500 text-white shadow-md shadow-rose-200/50 dark:shadow-rose-900/30' },
              ].map(({ id, label, shortLabel, activeClass }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  onClick={() => setActiveView(id)}
                  className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all sm:px-4 ${
                    activeView === id
                      ? activeClass
                      : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-700'
                  }`}
                >
                  <span className="sm:hidden">{shortLabel}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
            {/* Month/year selector for Trends view */}
            {activeView === 'trends' && (
              <MonthYearSelector month={month} year={year} onChange={handleMonthChange} accent="sky" />
            )}
            {/* Month/year selector for Calendar view */}
            {activeView === 'calendar' && (
              <MonthYearSelector month={month} year={year} onChange={handleMonthChange} accent="rose" />
            )}
            {/* Time-period controls — only for Summary and Plan vs Actual */}
            {(activeView === 'summary' || activeView === 'planVsActual') && (
              <div className="flex flex-wrap justify-end items-center gap-2 sm:gap-3">
                <div className="inline-flex rounded-xl border border-stone-200/60 bg-white p-1 shadow-sm dark:border-stone-700/60 dark:bg-stone-800">
                  <button
                    type="button"
                    onClick={() => setViewMode('monthly')}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                      viewMode === 'monthly'
                        ? activeView === 'planVsActual' ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200/50' : 'bg-amber-500 text-white shadow-md shadow-amber-200/50'
                        : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-700'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('ytd')}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                      viewMode === 'ytd'
                        ? activeView === 'planVsActual' ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200/50' : 'bg-amber-500 text-white shadow-md shadow-amber-200/50'
                        : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-700'
                    }`}
                  >
                    YTD
                  </button>
                </div>
                <MonthYearSelector month={month} year={year} onChange={handleMonthChange} accent={activeView === 'planVsActual' ? 'emerald' : 'amber'} />
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="animate-fade-in mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <span className="mr-1.5">⚠</span>{error}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
              ))}
            </div>
            <div className="h-16 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
            <div className="h-48 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
            <div className="h-48 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
          </div>
        ) : (
          <div className="space-y-8">
            {activeView === 'calendar' ? (
              <CalendarView month={month} year={year} />
            ) : activeView === 'annualActuals' ? (
              <AnnualActualsTable year={year} />
            ) : activeView === 'trends' ? (
              <Suspense fallback={<ChartFallback />}>
                <TrendChart
                  range={trendRange}
                  setRange={setTrendRange}
                  monthlyData={trendMonthlyData}
                  isLoading={trendLoading}
                  error={trendError}
                />
                <TrendSummary {...trendSummary} />
              </Suspense>
            ) : activeView === 'planVsActual' ? (
              <Suspense fallback={<ChartFallback />}>
                <PlanVsActual
                  month={month}
                  year={year}
                  viewMode={viewMode}
                  onMonthChange={handleMonthChange}
                  showSelector={false}
                />
              </Suspense>
            ) : (
              <>
                {/* Stat cards + YTD */}
                <MonthlyStats
                  income={viewMode === 'ytd' ? reportData.ytdIncome : reportData.income}
                  expenses={viewMode === 'ytd' ? reportData.ytdExpenses : reportData.expenses}
                  viewMode={viewMode}
                />

                {/* Income by category chart */}
                <CategoryChart
                  data={viewMode === 'ytd' ? reportData.ytdIncomeCategoryData : reportData.incomeCategoryData}
                  title="Income by Category"
                  emptyMessage={viewMode === 'ytd' ? 'No income recorded year to date.' : 'No income recorded this month.'}
                  cursorColor="rgba(16, 185, 129, 0.08)"
                  onCategoryClick={(name) => handleChartCategoryClick(name, 'income')}
                  expandedCategory={expandedChart?.type === 'income' ? expandedChart.name : null}
                  renderDrillDown={(name) => renderChartDrillDown(name, 'income')}
                />

                {/* Spending by category chart */}
                <CategoryChart
                  data={viewMode === 'ytd' ? reportData.ytdExpenseCategoryData : reportData.expenseCategoryData}
                  title="Spending by Category"
                  emptyMessage={viewMode === 'ytd' ? 'No expenses recorded year to date.' : 'No expenses recorded this month.'}
                  onCategoryClick={(name) => handleChartCategoryClick(name, 'expense')}
                  expandedCategory={expandedChart?.type === 'expense' ? expandedChart.name : null}
                  renderDrillDown={(name) => renderChartDrillDown(name, 'expense')}
                />

              </>
            )}


          </div>
        )}
      </div>
    </div>
  );
}
