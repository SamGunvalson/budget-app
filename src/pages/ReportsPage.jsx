import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/common/TopBar';
import MonthYearSelector from '../components/common/MonthYearSelector';
import MonthlyStats from '../components/reports/MonthlyStats';
import CategoryChart from '../components/reports/CategoryChart';
import CategoryDrillDown from '../components/reports/CategoryDrillDown';
import PlanVsActual from '../components/reports/PlanVsActual';
import TrendChart from '../components/reports/TrendChart';
import TrendSummary from '../components/reports/TrendSummary';
import {
  getTransactionsYTDOffline as getTransactionsYTD,
  getPendingReviewCountOffline as getPendingReviewCount,
  getCategoriesOffline as getCategories,
} from '../services/offlineAware';
import {
  getTrendTransactions,
  getYearlyTrendTransactions,
  aggregateByMonth,
  computeTrendSummary,
} from '../services/analytics';
import { getMonthName, isTrueIncome, isSpendingCredit, isIncomeDebit } from '../utils/helpers';
import useMonthYear from '../hooks/useMonthYear';
import useSessionState from '../hooks/useSessionState';
import AnnualActualsTable from '../components/reports/AnnualActualsTable';

export default function ReportsPage() {
  const { month, year, setMonthYear } = useMonthYear();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useSessionState('reportsViewMode', 'monthly'); // 'monthly' | 'ytd'
  // 'summary' | 'planVsActual' | 'trends' | 'annualActuals'
  const [activeView, setActiveView] = useSessionState('reportsActiveView', 'summary');

  // Trend-specific state — owned here so TrendSummary stays in sync
  const [trendRange, setTrendRange] = useSessionState('reportsTrendRange', '6m'); // '6m' | '12m' | 'yoy'
  const [trendMonthlyData, setTrendMonthlyData] = useState([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState('');

  // Raw transaction & category data for drill-down
  const [allTransactions, setAllTransactions] = useState([]);
  const [categories, setCategories] = useState([]);

  // Drill-down state: { name: string, type: 'income' | 'expense' } or null
  const [expandedChart, setExpandedChart] = useState(null);

  // Pending review count
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  const handleMonthChange = (m, y) => {
    setMonthYear(m, y);
  };

  useEffect(() => { document.title = 'Budget App | Reports'; }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError('');
      setExpandedChart(null);
      try {
        // Single fetch from Jan 1 → end of selected month; split client-side
        const [allYTD, cats, reviewCount] = await Promise.all([
          getTransactionsYTD({ year, throughMonth: month }),
          getCategories(),
          getPendingReviewCount(),
        ]);
        if (cancelled) return;
        setAllTransactions(allYTD);
        setCategories(cats);
        setPendingReviewCount(reviewCount);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load data');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [month, year]);

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

  // Trend data: separate effect keyed on month, year, and active range
  useEffect(() => {
    let cancelled = false;

    async function loadTrend() {
      setTrendLoading(true);
      setTrendError('');
      try {
        let raw;
        if (trendRange === 'yoy') {
          raw = await getYearlyTrendTransactions({ years: 2, endMonth: month, endYear: year });
        } else {
          const months = trendRange === '12m' ? 12 : 6;
          raw = await getTrendTransactions({ months, endMonth: month, endYear: year });
        }
        if (cancelled) return;
        setTrendMonthlyData(aggregateByMonth(raw));
      } catch (err) {
        if (!cancelled) setTrendError(err.message || 'Failed to load trend data');
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    }

    loadTrend();
    return () => { cancelled = true; };
  }, [month, year, trendRange]);

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
    [getDrillDownTransactions, categories, viewMode, reportData],
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <TopBar pageName="Reports" />

      {/* Content */}
      <div className={`mx-auto px-4 py-8 sm:px-6 ${activeView === 'annualActuals' ? 'max-w-full' : 'max-w-6xl'}`}>
        {/* Header row */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="animate-fade-in">
            <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              {activeView === 'annualActuals'
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
              {activeView === 'annualActuals'
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
            {activeView === 'annualActuals' ? (
              <AnnualActualsTable year={year} />
            ) : activeView === 'trends' ? (
              <>
                <TrendChart
                  range={trendRange}
                  setRange={setTrendRange}
                  monthlyData={trendMonthlyData}
                  isLoading={trendLoading}
                  error={trendError}
                />
                <TrendSummary {...trendSummary} />
              </>
            ) : activeView === 'planVsActual' ? (
              <PlanVsActual
                month={month}
                year={year}
                viewMode={viewMode}
                onMonthChange={handleMonthChange}
                showSelector={false}
              />
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
