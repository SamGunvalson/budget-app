import { useEffect, useCallback, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import TopBar from '../components/common/TopBar';
import PageHeader from '../components/common/PageHeader';
import SegmentedControl from '../components/common/SegmentedControl';
import YearSelector from '../components/common/YearSelector';
import MonthYearSelector from '../components/common/MonthYearSelector';
import CategoryExplorer from '../components/reports/CategoryExplorer';
import Overview from '../components/reports/Overview';
import PayeeExplorer from '../components/reports/PayeeExplorer';
// Defer recharts-bound charts until the user opens those tabs. Each lazy
// import becomes its own JS chunk that pulls in `recharts` only when first
// rendered, keeping the Reports route's first-paint bundle small.
const TrendsView = lazy(() => import('../components/reports/TrendsView'));
import { usePendingReviewCount } from '../hooks/queries';
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
  { value: 'overview', label: 'Overview' },
  { value: 'categories', label: 'Categories' },
  { value: 'trends', label: 'Trends' },
  { value: 'annualActuals', label: 'Annual Actuals', shortLabel: 'Annual' },
  { value: 'calendar', label: 'Calendar', shortLabel: 'Cal' },
];
const VIEW_IDS = new Set(VIEWS.map((v) => v.value));
const DEFAULT_VIEW = 'overview';
// Retired tabs (REPORTS_REDESIGN_PLAN PRs 2–3); keeps old session state and
// `?view=` links working.
const LEGACY_VIEWS = { summary: 'overview', planVsActual: 'categories' };
// Deep-link params owned by the active view; cleared when the user picks a tab.
const VIEW_PARAMS = ['view', 'category', 'compare', 'lens', 'payee'];
// Views that use the Monthly / YTD period (Categories › Payees uses a fixed
// 12-month window instead).
const PERIOD_VIEWS = new Set(['overview', 'categories']);

// Categories tab lenses. Deep-link `?lens=` and `?payee=` params (from
// Overview) win until the user picks a lens or tab.
const LENS_OPTIONS = [
  { value: 'list', label: 'List' },
  { value: 'payees', label: 'Payees' },
];
const LENS_IDS = new Set(LENS_OPTIONS.map((o) => o.value));

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
function viewHeading(view, viewMode, month, year, lens) {
  const monthLabel = `${getMonthName(month)} ${year}`;
  if (view === 'categories' && lens === 'payees') {
    return { eyebrow: `12 months to ${monthLabel}`, title: 'Payees' };
  }
  switch (view) {
    case 'calendar':
      return { eyebrow: `${monthLabel} daily view`, title: 'Transaction Calendar' };
    case 'annualActuals':
      return { eyebrow: `${year} actual spending by category`, title: 'Annual Actuals' };
    case 'trends':
      return { eyebrow: 'Track your spending patterns over time', title: 'Spending Trends' };
    case 'overview':
      return {
        eyebrow: viewMode === 'ytd' ? `Jan \u2013 ${getMonthName(month)} ${year} in review` : `${monthLabel} in review`,
        title: 'Overview',
      };
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
  // 'overview' | 'categories' | 'trends' | 'annualActuals' | 'calendar'.
  // A valid `?view=` deep link wins until the user picks a tab.
  const [sessionView, setSessionView] = useSessionState('reportsActiveView', DEFAULT_VIEW);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = resolveView(searchParams.get('view')) ?? resolveView(sessionView) ?? DEFAULT_VIEW;
  const setActiveView = useCallback((view) => {
    setSessionView(view);
    if (VIEW_PARAMS.some((key) => searchParams.has(key))) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const key of VIEW_PARAMS) next.delete(key);
        return next;
      }, { replace: true });
    }
  }, [setSessionView, searchParams, setSearchParams]);

  const [sessionLens, setSessionLens] = useSessionState('reportsCategoriesLens', 'list');
  const lensParam = searchParams.get('lens');
  const lens = LENS_IDS.has(lensParam) ? lensParam : LENS_IDS.has(sessionLens) ? sessionLens : 'list';
  const setLens = useCallback((value) => {
    setSessionLens(value);
    if (['lens', 'payee', 'category'].some((key) => searchParams.has(key))) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const key of ['lens', 'payee', 'category']) next.delete(key);
        return next;
      }, { replace: true });
    }
  }, [setSessionLens, searchParams, setSearchParams]);
  const showPayees = activeView === 'categories' && lens === 'payees';

  const [trendRange, setTrendRange] = useSessionState('reportsTrendRange', '6m'); // '6m' | '12m' | 'yoy'

  // Reports count only settled activity (posted, dated today or earlier) unless
  // the user opts in to projected/pending/future-dated rows. Shared by every
  // tab except Calendar, which always shows upcoming items.
  const [includePending, setIncludePending] = useSessionState('reportsIncludePending', false);
  const asOf = includePending ? null : getTodayString();

  const pendingReviewCount = usePendingReviewCount().data ?? 0;

  useEffect(() => { document.title = 'Budget App | Reports'; }, []);

  const heading = viewHeading(activeView, viewMode, month, year, lens);

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
            <SegmentedControl className="order-1" ariaLabel="Categories view" options={LENS_OPTIONS} value={lens} onChange={setLens} />
          )}
          {PERIOD_VIEWS.has(activeView) && !showPayees && (
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
              <TrendsView month={month} year={year} range={trendRange} asOf={asOf} />
            </Suspense>
          ) : showPayees ? (
            <PayeeExplorer month={month} year={year} asOf={asOf} />
          ) : activeView === 'categories' ? (
            <CategoryExplorer month={month} year={year} viewMode={viewMode} asOf={asOf} />
          ) : (
            <Overview month={month} year={year} viewMode={viewMode} asOf={asOf} />
          )}
        </div>
      </div>
    </div>
  );
}
