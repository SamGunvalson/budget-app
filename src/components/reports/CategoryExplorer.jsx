import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import CategoryWell from '../common/CategoryWell';
import ChangeChip from './ChangeChip';
import DataUnavailable from '../common/DataUnavailable';
import EmptyState from '../common/EmptyState';
import SegmentedControl from '../common/SegmentedControl';
import useReportData from '../../hooks/useReportData';
import useCategoryDrillDown from '../../hooks/useCategoryDrillDown';
import useSessionState from '../../hooks/useSessionState';
import useThresholds from '../../hooks/useThresholds';
import { alertLevel, percentUsed } from '../../utils/budgetCalculations';
import { CATEGORY_TYPE_LABELS, formatCurrency, getMonthName } from '../../utils/helpers';
import {
  COMPARE_OPTIONS,
  categoryComparisonGroups,
  categoryTotals,
  comparisonPeriod,
  plannedByCategory,
  reportPeriodKeys,
  resolveCompareMode,
  txMonthKey,
} from '../../utils/reportAggregations';

const money = (cents) => formatCurrency(cents, 'USD', { hideCents: true });

const TYPE_DOTS = {
  income: 'bg-emerald-500',
  needs: 'bg-rose-500',
  wants: 'bg-pink-500',
  savings: 'bg-teal-500',
  other: 'bg-stone-400',
};

/** Short phrase naming what a row is compared against. */
function compareNoun(mode) {
  switch (mode) {
    case 'lastMonth': return 'last month';
    case 'avg3': return '3-mo avg';
    case 'lastYear': return 'last year';
    default: return 'plan';
  }
}

/** Status chip for a row or total: plan progress, or change vs history. */
function StatusChip({ isIncome, actual, compare, planMode, thresholds }) {
  if (planMode) {
    if (compare === 0) {
      return <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600 dark:bg-stone-700 dark:text-stone-300">Unbudgeted</span>;
    }
    const left = compare - actual;
    if (isIncome) {
      return left > 0
        ? <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{money(left)} to go</span>
        : <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{left < 0 ? `+${money(-left)} extra` : 'Received'}</span>;
    }
    if (left >= 0) return <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{money(left)} left</span>;
    const level = alertLevel(percentUsed(actual, compare), thresholds);
    return (
      <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
        level === 'danger'
          ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
          : 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300'
      }`}>
        {money(-left)} over
      </span>
    );
  }

  return <ChangeChip actual={actual} compare={compare} isIncome={isIncome} />;
}

/**
 * Thin track under a row. Plan mode: share of plan used, colored by the
 * budget thresholds (as on Budgets). History modes: actual vs the
 * comparison, with a tick marking the comparison value.
 */
function RowTrack({ name, isIncome, actual, compare, planMode, thresholds }) {
  const shown = Math.max(actual, 0);
  if (planMode) {
    if (compare <= 0) return null;
    const pct = percentUsed(shown, compare);
    const level = isIncome ? 'success' : alertLevel(pct, thresholds);
    const color = isIncome
      ? 'bg-emerald-500 dark:bg-emerald-400'
      : level === 'danger' ? 'bg-red-500 dark:bg-red-400'
      : level === 'warning' ? 'bg-orange-500 dark:bg-orange-400'
      : 'bg-emerald-600/80 dark:bg-emerald-400/80';
    return (
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
        role="progressbar"
        aria-label={`${name}: ${Math.round(Math.min(pct, 999))}% of plan`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(pct, 100))}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    );
  }

  const scale = Math.max(shown, compare, 1);
  return (
    <div className="relative h-1.5 flex-1 rounded-full bg-stone-200 dark:bg-stone-700" aria-hidden="true">
      <div
        className={`h-full rounded-full ${isIncome ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-violet-500/80 dark:bg-violet-400/80'}`}
        style={{ width: `${(shown / scale) * 100}%` }}
      />
      {compare > 0 && (
        <span
          className="absolute -top-0.5 h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-stone-900 dark:bg-stone-100"
          style={{ left: `${(compare / scale) * 100}%` }}
        />
      )}
    </div>
  );
}

/**
 * Reports › Categories: every category's actual for the period against a
 * chosen comparison (plan, last month, 3-month average, or last year), grouped
 * by type. Each row expands into the editable transaction list, the main way
 * to find and fix miscategorized transactions.
 *
 * Computed on the client from the offline-capable year transactions and
 * annual budget data, like Annual Actuals.
 *
 * Deep links: `?category=<id>` opens (and scrolls to) that category's
 * drill-down; `?compare=<mode>` picks the comparison until the user changes it.
 *
 * @param {{ month: number, year: number, viewMode: 'monthly' | 'ytd', asOf: string | null }} props
 */
export default function CategoryExplorer({ month, year, viewMode, asOf }) {
  const { thresholds } = useThresholds();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusCategoryId = searchParams.get('category');
  const [compareSetting, setCompareSetting] = useSessionState('reportsCompareTo', 'plan');
  const compareMode = resolveCompareMode(viewMode, searchParams.get('compare') ?? compareSetting);
  const planMode = compareMode === 'plan';
  const handleCompareChange = (mode) => {
    setCompareSetting(mode);
    if (searchParams.has('compare')) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('compare');
        return next;
      }, { replace: true });
    }
  };

  const periodKeys = useMemo(() => reportPeriodKeys(year, month, viewMode), [year, month, viewMode]);
  const comparison = useMemo(
    () => comparisonPeriod(year, month, viewMode, compareMode),
    [year, month, viewMode, compareMode],
  );

  const { settled, matrix, categories, budget, setYearTransactions, isLoading, failed } = useReportData({
    year,
    keyLists: [periodKeys, comparison.keys],
    asOf,
    withBudget: planMode,
  });

  const groups = useMemo(() => {
    const actual = categoryTotals(matrix, periodKeys);
    const compare = planMode
      ? plannedByCategory(budget, periodKeys, year)
      : categoryTotals(matrix, comparison.keys, comparison.divisor);
    return categoryComparisonGroups({ actual, compare, categories, meta: matrix.meta });
  }, [matrix, periodKeys, planMode, budget, year, comparison, categories]);

  // Drill-down: the period's transactions; edits update the year query cache.
  const periodTransactions = useMemo(() => {
    const keys = new Set(periodKeys);
    return settled.filter((t) => keys.has(txMonthKey(t)));
  }, [settled, periodKeys]);
  const drill = useCategoryDrillDown({
    transactions: periodTransactions,
    categories,
    setTransactions: setYearTransactions,
    resetKey: periodKeys.join(','),
    initialExpandedId: focusCategoryId,
  });

  // Bring a deep-linked category into view once its row exists.
  useEffect(() => {
    if (isLoading || !focusCategoryId) return;
    document.getElementById(`category-row-${focusCategoryId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [isLoading, focusCategoryId]);

  const periodLabel = viewMode === 'ytd'
    ? `Jan – ${getMonthName(month)} ${year}`
    : `${getMonthName(month)} ${year}`;
  const noun = compareNoun(compareMode);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-28 animate-pulse rounded-2xl border border-stone-200/60 bg-white dark:border-stone-700/60 dark:bg-stone-800" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-2xl border border-stone-200/60 bg-white dark:border-stone-700/60 dark:bg-stone-800" />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <DataUnavailable
        eyebrow={periodLabel}
        title="Categories unavailable"
        message="Couldn't load transactions or budgets for this period, so no totals are shown."
        onRetry={() => failed.refetch()}
        retrying={failed.isFetching}
      />
    );
  }

  const spendGroups = groups.filter((g) => g.type !== 'income');
  const incomeGroup = groups.find((g) => g.type === 'income');
  const totals = {
    spent: spendGroups.reduce((s, g) => s + g.actual, 0),
    spentCompare: spendGroups.reduce((s, g) => s + g.compare, 0),
    income: incomeGroup?.actual ?? 0,
    incomeCompare: incomeGroup?.compare ?? 0,
  };

  return (
    <div className="animate-fade-in space-y-6">
      {/* Totals + compare-to */}
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-stone-200/60 bg-white p-5 shadow-sm dark:border-stone-700/60 dark:bg-stone-800">
        <dl className="grid w-full grid-cols-2 gap-4 sm:w-auto sm:max-w-lg sm:flex-1">
          {[
            { label: 'Spent', value: totals.spent, compare: totals.spentCompare, isIncome: false },
            { label: 'Income', value: totals.income, compare: totals.incomeCompare, isIncome: true },
          ].map((t) => (
            <div key={t.label}>
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">{t.label}</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-stone-900 sm:text-2xl dark:text-stone-100">{money(t.value)}</dd>
              <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                <span>vs {money(t.compare)} {noun}</span>
                {(t.value !== 0 || t.compare !== 0) && (
                  <StatusChip isIncome={t.isIncome} actual={t.value} compare={t.compare} planMode={planMode} thresholds={thresholds} />
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">Compare to</span>
          <SegmentedControl
            ariaLabel="Compare to"
            size="sm"
            options={COMPARE_OPTIONS[viewMode] ?? COMPARE_OPTIONS.monthly}
            value={compareMode}
            onChange={handleCompareChange}
          />
        </div>
      </section>

      {groups.length === 0 ? (
        <EmptyState
          title="No category activity"
          hint={`Nothing recorded for ${periodLabel}${planMode ? ' and no budget set' : ''}.`}
        />
      ) : (
        groups.map((group) => {
          const isIncome = group.type === 'income';
          return (
            <section key={group.type} aria-labelledby={`cat-group-${group.type}`}>
              <div className="mb-2 flex items-end justify-between gap-3 px-1">
                <h3 id={`cat-group-${group.type}`} className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600 dark:text-stone-300">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TYPE_DOTS[group.type]}`} />
                  {CATEGORY_TYPE_LABELS[group.type] ?? 'Other'}
                </h3>
                <p className="text-xs tabular-nums text-stone-500 dark:text-stone-400">
                  {money(group.actual)} {isIncome ? 'received' : 'spent'} · <span className="font-semibold text-stone-700 dark:text-stone-200">{money(group.compare)}</span> {noun}
                </p>
              </div>
              <div className="divide-y divide-stone-200/60 overflow-hidden rounded-2xl border border-stone-200/60 bg-white shadow-sm dark:divide-stone-700/60 dark:border-stone-700/60 dark:bg-stone-800">
                {group.rows.map((row) => {
                  const expanded = drill.expandedId === row.categoryId;
                  const name = `${row.name}${row.archived ? ' (Archived)' : ''}`;
                  return (
                    <div key={row.categoryId} id={`category-row-${row.categoryId}`} className="scroll-mt-24">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => drill.toggle(row.categoryId)}
                        className={`block w-full px-4 py-3 text-left transition-colors hover:bg-stone-50 focus:outline-none focus-visible:bg-stone-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 dark:hover:bg-stone-700/40 dark:focus-visible:bg-stone-700/40 ${expanded ? 'bg-stone-50 dark:bg-stone-700/40' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <CategoryWell category={{ name: row.name, color: row.color }} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{name}</p>
                            <p className="text-xs tabular-nums text-stone-500 dark:text-stone-400">
                              {money(row.compare)} {noun}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">{money(row.actual)}</span>
                            <StatusChip isIncome={isIncome} actual={row.actual} compare={row.compare} planMode={planMode} thresholds={thresholds} />
                          </div>
                          <svg
                            aria-hidden="true"
                            className={`h-4 w-4 shrink-0 text-stone-400 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
                            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </div>
                        <div className="mt-2.5 flex items-center pl-12 pr-7">
                          <RowTrack name={row.name} isIncome={isIncome} actual={row.actual} compare={row.compare} planMode={planMode} thresholds={thresholds} />
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t border-stone-200/60 dark:border-stone-700/60">
                          {drill.render(row.categoryId, { name: row.name, color: row.color })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
