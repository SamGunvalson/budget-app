import { useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import TopBar from '../components/common/TopBar';
import PageHeader from '../components/common/PageHeader';
import SegmentedControl from '../components/common/SegmentedControl';
import YearSelector from '../components/common/YearSelector';
import MonthYearSelector from '../components/common/MonthYearSelector';
import MonthlyStats from '../components/reports/MonthlyStats';
import CategoryChart from '../components/reports/CategoryChart';
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
import {
  getMonthName,
  getTodayString,
  isTrueIncome,
  isSpendingCredit,
  isIncomeDebit,
  isSettledTransaction,
} from '../utils/helpers';
import useMonthYear from '../hooks/useMonthYear';
import useSessionState from '../hooks/useSessionState';
import useCategoryDrillDown from '../hooks/useCategoryDrillDown';
import { monthKey, txMonthKey } from '../utils/reportAggregations';
import AnnualActualsTable from '../components/reports/AnnualActualsTable';
import CalendarView from '../components/reports/CalendarView';
import IncludePendingToggle from '../components/reports/IncludePendingToggle';
import { CATEGORY_FALLBACK_COLOR } from '../constants/chartColors';
import { isQueryUnavailable } from '../utils/queryState';
import DataUnavailable from '../components/common/DataUnavailable';

// Skeleton placeholder shown while a lazy chart chunk is downloading.
function ChartFallback() {
  return (
    <div className="h-72 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
  );
}

const VIEWS = [
  { value: 'summary', label: 'Summary' },
  { value: 'planVsActual', label: 'Plan vs Actual', shortLabel: 'Plan' },
  { value: 'trends', label: 'Trends' },
  { value: 'annualActuals', label: 'Annual Actuals', shortLabel: 'Annual' },
  { value: 'calendar', label: 'Calendar', shortLabel: 'Cal' },
];
const VIEW_IDS = new Set(VIEWS.map((v) => v.value));

const PERIOD_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'ytd', label: 'YTD' },
];

const TREND_RANGE_OPTIONS = [
  { value: '6m', label: '6 Months', shortLabel: '6M' },
  { value: '12m', label: '12 Months', shortLabel: '12M' },
  { value: 'yoy', label: 'Year over Year', shortLabel: 'YoY' },
];

/** Eyebrow and title for the active view. */
function viewHeading(view, viewMode, month, year) {
  const monthLabel = `${getMonthName(month)} ${year}`;
  const ytdLabel = `Jan \u2013 ${getMonthName(month)} ${year}`;
  switch (view) {
    case 'calendar':
      return { eyebrow: `${monthLabel} daily view`, title: 'Transaction Calendar' };
    case 'annualActuals':
      return { eyebrow: `${year} actual spending by category`, title: 'Annual Actuals' };
    case 'trends':
      return { eyebrow: 'Track your spending patterns over time', title: 'Spending Trends' };
    case 'planVsActual':
      return { eyebrow: `${viewMode === 'ytd' ? ytdLabel : monthLabel} budget comparison`, title: 'Plan vs Actual' };
    default:
      return viewMode === 'ytd'
        ? { eyebrow: `${ytdLabel} overview`, title: 'YTD Summary' }
        : { eyebrow: `${monthLabel} overview`, title: 'Monthly Summary' };
  }
}

export default function ReportsPage() {
  const { month, year, setMonthYear } = useMonthYear();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useSessionState('reportsViewMode', 'monthly'); // 'monthly' | 'ytd'
  // 'summary' | 'planVsActual' | 'trends' | 'annualActuals' | 'calendar'.
  // A valid `?view=` deep link wins until the user picks a tab.
  const [sessionView, setSessionView] = useSessionState('reportsActiveView', 'summary');
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const activeView = VIEW_IDS.has(viewParam) ? viewParam : VIEW_IDS.has(sessionView) ? sessionView : 'summary';
  const setActiveView = useCallback((view) => {
    setSessionView(view);
    if (searchParams.has('view')) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('view');
        return next;
      }, { replace: true });
    }
  }, [setSessionView, searchParams, setSearchParams]);

  // Trend-specific state — owned here so TrendSummary stays in sync
  const [trendRange, setTrendRange] = useSessionState('reportsTrendRange', '6m'); // '6m' | '12m' | 'yoy'

  // Reports count only settled activity (posted, dated today or earlier) unless
  // the user opts in to projected/pending/future-dated rows. Shared by every
  // tab except Calendar, which always shows upcoming items.
  const [includePending, setIncludePending] = useSessionState('reportsIncludePending', false);
  const asOf = includePending ? null : getTodayString();

  // Raw transaction & category data for drill-down + pending count.
  // react-query (Phase 2) handles loading + auto-refresh on table changes.
  const ytdQuery = useTransactionsYTD(year, month);
  const categoriesQuery = useCategories();
  const pendingQuery = usePendingReviewCount();
  const allTransactions = useMemo(() => ytdQuery.data ?? [], [ytdQuery.data]);
  const reportTransactions = useMemo(
    () => allTransactions.filter((t) => isSettledTransaction(t, asOf)),
    [allTransactions, asOf],
  );
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const pendingReviewCount = pendingQuery.data ?? 0;
  const isLoading =
    ytdQuery.isLoading || categoriesQuery.isLoading || pendingQuery.isLoading;
  // Summary figures come from the YTD transactions; without them, show
  // "unavailable" in the Summary view rather than $0 totals.
  const summaryUnavailable = isQueryUnavailable(ytdQuery);
  const error =
    (summaryUnavailable ? '' : ytdQuery.error?.message) ||
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

    for (const t of reportTransactions) {
      if (t.categories?.type === 'transfer') continue;

      const catId = t.category_id || 'uncategorized';
      const catName = t.categories?.name || 'Uncategorized';
      const catColor = t.categories?.color || CATEGORY_FALLBACK_COLOR;

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
  }, [reportTransactions, month, year]);

  // Trend data: backed by Phase 3 server-side aggregation RPCs via React
  // Query.  All three ranges return monthly buckets (yoy = 24 months) so
  // TrendChart and computeTrendSummary share a single shape.
  const trendMonths = trendRange === 'yoy' ? 24 : trendRange === '12m' ? 12 : 6;
  const trendQuery = useMonthlySpendingTrend({
    months: trendMonths,
    endMonth: month,
    endYear: year,
    asOf,
  });
  const trendMonthlyData = useMemo(() => trendQuery.data ?? [], [trendQuery.data]);
  const trendLoading = trendQuery.isLoading;
  const trendError = trendQuery.error?.message || '';

  // Trend summary derived from the active range's monthly data
  const trendSummary = useMemo(
    () => computeTrendSummary(trendMonthlyData),
    [trendMonthlyData],
  );

  // ---------- Summary drill-down ----------

  const incomeCategoryData = viewMode === 'ytd' ? reportData.ytdIncomeCategoryData : reportData.incomeCategoryData;
  const expenseCategoryData = viewMode === 'ytd' ? reportData.ytdExpenseCategoryData : reportData.expenseCategoryData;

  // Transactions in the Summary period (the YTD query already ends at `month`).
  const periodTransactions = useMemo(() => {
    if (viewMode === 'ytd') return reportTransactions;
    const key = monthKey(year, month);
    return reportTransactions.filter((t) => txMonthKey(t) === key);
  }, [reportTransactions, viewMode, year, month]);

  const drill = useCategoryDrillDown({
    transactions: periodTransactions,
    categories,
    setTransactions: setAllTransactions,
    resetKey: `${year}-${month}-${viewMode}`,
  });

  // CategoryChart identifies rows by name; map back to the category id.
  const chartDrillProps = (data) => {
    const byName = (name) => data.find((d) => d.name === name);
    return {
      expandedCategory: data.find((d) => d.categoryId === drill.expandedId)?.name ?? null,
      onCategoryClick: (name) => {
        const entry = byName(name);
        if (entry) drill.toggle(entry.categoryId);
      },
      renderDrillDown: (name) => {
        const entry = byName(name);
        return entry ? drill.render(entry.categoryId, { name: entry.name, color: entry.color }) : null;
      },
    };
  };

  const heading = viewHeading(activeView, viewMode, month, year);
  const showPeriod = activeView === 'summary' || activeView === 'planVsActual';

  return (
    <div className="min-h-screen app-bg">
      <TopBar pageName="Reports" />

      {/* Content */}
      <div className={`mx-auto px-4 py-8 sm:px-6 ${activeView === 'annualActuals' || activeView === 'calendar' ? 'max-w-full' : 'max-w-6xl'}`}>
        <PageHeader
          eyebrow={heading.eyebrow}
          title={heading.title}
          className="mb-4"
          description={pendingReviewCount > 0 && (
            <Link
              to="/app/transactions?status=pending"
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold text-white">
                {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
              </span>
              Needs Review
            </Link>
          )}
        >
          <SegmentedControl ariaLabel="Report view" options={VIEWS} value={activeView} onChange={setActiveView} />
        </PageHeader>

        {/* Shared control row: only the controls that apply to this view */}
        <div className="mb-8 flex flex-wrap items-center gap-2 sm:gap-3">
          {showPeriod && (
            <SegmentedControl ariaLabel="Period" options={PERIOD_OPTIONS} value={viewMode} onChange={setViewMode} />
          )}
          {activeView === 'trends' && (
            <SegmentedControl ariaLabel="Trend range" size="sm" options={TREND_RANGE_OPTIONS} value={trendRange} onChange={setTrendRange} />
          )}
          {activeView === 'annualActuals' ? (
            <YearSelector year={year} onChange={(y) => setMonthYear(month, y)} />
          ) : (
            <MonthYearSelector month={month} year={year} onChange={handleMonthChange} />
          )}
          {/* Pending/upcoming toggle — every view except Calendar */}
          {activeView !== 'calendar' && (
            <div className="sm:ml-auto">
              <IncludePendingToggle checked={includePending} onChange={setIncludePending} />
            </div>
          )}
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
              <AnnualActualsTable year={year} asOf={asOf} />
            ) : activeView === 'trends' ? (
              <Suspense fallback={<ChartFallback />}>
                <TrendChart
                  range={trendRange}
                  monthlyData={trendMonthlyData}
                  isLoading={trendLoading}
                  error={trendError}
                />
                {!trendError && <TrendSummary {...trendSummary} />}
              </Suspense>
            ) : activeView === 'planVsActual' ? (
              <Suspense fallback={<ChartFallback />}>
                <PlanVsActual
                  month={month}
                  year={year}
                  viewMode={viewMode}
                  onMonthChange={handleMonthChange}
                  showSelector={false}
                  asOf={asOf}
                />
              </Suspense>
            ) : summaryUnavailable ? (
              <DataUnavailable
                eyebrow={viewMode === 'ytd' ? `${year} year to date` : `${getMonthName(month)} ${year}`}
                title="Summary unavailable"
                message="Couldn't load transactions for this period, so no totals are shown."
                onRetry={() => ytdQuery.refetch()}
                retrying={ytdQuery.isFetching}
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
                  data={incomeCategoryData}
                  title="Income by Category"
                  emptyMessage={viewMode === 'ytd' ? 'No income recorded year to date.' : 'No income recorded this month.'}
                  cursorColor="rgba(16, 185, 129, 0.08)"
                  {...chartDrillProps(incomeCategoryData)}
                />

                {/* Spending by category chart */}
                <CategoryChart
                  data={expenseCategoryData}
                  title="Spending by Category"
                  emptyMessage={viewMode === 'ytd' ? 'No expenses recorded year to date.' : 'No expenses recorded this month.'}
                  {...chartDrillProps(expenseCategoryData)}
                />

              </>
            )}


          </div>
        )}
      </div>
    </div>
  );
}
