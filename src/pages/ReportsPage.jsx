import { useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import TopBar from '../components/common/TopBar';
import PageHeader from '../components/common/PageHeader';
import SegmentedControl from '../components/common/SegmentedControl';
import YearSelector from '../components/common/YearSelector';
import MonthYearSelector from '../components/common/MonthYearSelector';
import CategoryExplorer from '../components/reports/CategoryExplorer';
// Defer recharts-bound charts until the user opens those tabs. Each lazy
// import becomes its own JS chunk that pulls in `recharts` only when first
// rendered, keeping the Reports route's first-paint bundle small.
const TrendChart = lazy(() => import('../components/reports/TrendChart'));
import TrendSummary from '../components/reports/TrendSummary';
import { usePendingReviewCount, useMonthlySpendingTrend } from '../hooks/queries';
import { computeTrendSummary } from '../services/analytics';
import { getMonthName, getTodayString } from '../utils/helpers';
import useMonthYear from '../hooks/useMonthYear';
import useSessionState from '../hooks/useSessionState';
import AnnualActualsTable from '../components/reports/AnnualActualsTable';
import CalendarView from '../components/reports/CalendarView';
import IncludePendingToggle from '../components/reports/IncludePendingToggle';

// Skeleton placeholder shown while a lazy chart chunk is downloading.
function ChartFallback() {
  return (
    <div className="h-72 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
  );
}

const VIEWS = [
  { value: 'categories', label: 'Categories' },
  { value: 'trends', label: 'Trends' },
  { value: 'annualActuals', label: 'Annual Actuals', shortLabel: 'Annual' },
  { value: 'calendar', label: 'Calendar', shortLabel: 'Cal' },
];
const VIEW_IDS = new Set(VIEWS.map((v) => v.value));
const DEFAULT_VIEW = 'categories';
// Tabs folded into Categories (REPORTS_REDESIGN_PLAN PR 2); keeps old
// session state and `?view=` links working.
const LEGACY_VIEWS = { summary: 'categories', planVsActual: 'categories' };

/** A known view id for `value`, mapping retired tabs; null when unknown. */
function resolveView(value) {
  const mapped = LEGACY_VIEWS[value] ?? value;
  return VIEW_IDS.has(mapped) ? mapped : null;
}

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
  switch (view) {
    case 'calendar':
      return { eyebrow: `${monthLabel} daily view`, title: 'Transaction Calendar' };
    case 'annualActuals':
      return { eyebrow: `${year} actual spending by category`, title: 'Annual Actuals' };
    case 'trends':
      return { eyebrow: 'Track your spending patterns over time', title: 'Spending Trends' };
    default:
      return {
        eyebrow: viewMode === 'ytd' ? `Jan – ${getMonthName(month)} ${year}` : monthLabel,
        title: 'Categories',
      };
  }
}

export default function ReportsPage() {
  const { month, year, setMonthYear } = useMonthYear();
  const [viewMode, setViewMode] = useSessionState('reportsViewMode', 'monthly'); // 'monthly' | 'ytd'
  // 'categories' | 'trends' | 'annualActuals' | 'calendar'.
  // A valid `?view=` deep link wins until the user picks a tab.
  const [sessionView, setSessionView] = useSessionState('reportsActiveView', DEFAULT_VIEW);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = resolveView(searchParams.get('view')) ?? resolveView(sessionView) ?? DEFAULT_VIEW;
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

  const [trendRange, setTrendRange] = useSessionState('reportsTrendRange', '6m'); // '6m' | '12m' | 'yoy'

  // Reports count only settled activity (posted, dated today or earlier) unless
  // the user opts in to projected/pending/future-dated rows. Shared by every
  // tab except Calendar, which always shows upcoming items.
  const [includePending, setIncludePending] = useSessionState('reportsIncludePending', false);
  const asOf = includePending ? null : getTodayString();

  const pendingReviewCount = usePendingReviewCount().data ?? 0;

  useEffect(() => { document.title = 'Budget App | Reports'; }, []);

  // Trend data: server-side aggregation RPCs via React Query. All three ranges
  // return monthly buckets (yoy = 24 months) so TrendChart and
  // computeTrendSummary share one shape.
  const trendMonths = trendRange === 'yoy' ? 24 : trendRange === '12m' ? 12 : 6;
  const trendQuery = useMonthlySpendingTrend(
    { months: trendMonths, endMonth: month, endYear: year, asOf },
    { enabled: activeView === 'trends' },
  );
  const trendMonthlyData = useMemo(() => trendQuery.data ?? [], [trendQuery.data]);
  const trendError = trendQuery.error?.message || '';
  const trendSummary = useMemo(() => computeTrendSummary(trendMonthlyData), [trendMonthlyData]);

  const heading = viewHeading(activeView, viewMode, month, year);

  return (
    <div className="min-h-screen app-bg">
      <TopBar pageName="Reports" />

      {/* Categories stays max-w-6xl so its drill-down keeps the full
          transaction table (inline category editing) instead of the compact list. */}
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

        {/* Shared control row: only the controls that apply to this view.
            Phones: period/range and Include upcoming share the first line,
            the date picker wraps below. Wider: the toggle sits far right. */}
        <div className="mb-8 flex flex-wrap items-center gap-2 sm:gap-3">
          {activeView === 'categories' && (
            <SegmentedControl className="order-1" ariaLabel="Period" options={PERIOD_OPTIONS} value={viewMode} onChange={setViewMode} />
          )}
          {activeView === 'trends' && (
            <SegmentedControl className="order-1" ariaLabel="Trend range" size="sm" options={TREND_RANGE_OPTIONS} value={trendRange} onChange={setTrendRange} />
          )}
          <div className="order-3 sm:order-2">
            {activeView === 'annualActuals' ? (
              <YearSelector year={year} onChange={(y) => setMonthYear(month, y)} />
            ) : (
              <MonthYearSelector month={month} year={year} onChange={setMonthYear} />
            )}
          </div>
          {/* Pending/upcoming toggle — every view except Calendar */}
          {activeView !== 'calendar' && (
            <div className="order-2 sm:order-3 sm:ml-auto">
              <IncludePendingToggle checked={includePending} onChange={setIncludePending} />
            </div>
          )}
        </div>

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
                isLoading={trendQuery.isLoading}
                error={trendError}
              />
              {!trendError && <TrendSummary {...trendSummary} />}
            </Suspense>
          ) : (
            <CategoryExplorer month={month} year={year} viewMode={viewMode} asOf={asOf} />
          )}
        </div>
      </div>
    </div>
  );
}
