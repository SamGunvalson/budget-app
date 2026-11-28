import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import CategoryWell from '../common/CategoryWell';
import DataUnavailable from '../common/DataUnavailable';
import EmptyState from '../common/EmptyState';
import ChangeChip from './ChangeChip';
import { usePendingReviewCount } from '../../hooks/queries';
import useReportData from '../../hooks/useReportData';
import { formatCurrency, getMonthName } from '../../utils/helpers';
import {
  categoryTotals,
  comparisonPeriod,
  largestTransactions,
  periodSummary,
  plannedByCategory,
  planStatus,
  reportPeriodKeys,
  topMovers,
} from '../../utils/reportAggregations';

const money = (cents) => formatCurrency(cents, 'USD', { hideCents: true });

const PANEL = 'rounded-2xl border border-stone-200/60 bg-white p-5 shadow-sm dark:border-stone-700/60 dark:bg-stone-800';
const PANEL_TITLE = 'text-sm font-semibold text-stone-900 dark:text-stone-100';
const PANEL_SUB = 'text-xs text-stone-500 dark:text-stone-400';
const ROW_LINK = 'flex items-center gap-3 rounded-xl px-2 py-2 -mx-2 transition-colors hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-stone-700/40';

const MIX = [
  { type: 'needs', label: 'Needs', bar: 'bg-rose-500' },
  { type: 'wants', label: 'Wants', bar: 'bg-pink-500' },
  { type: 'savings', label: 'Savings', bar: 'bg-teal-500' },
];

/** Link into another Reports tab, keeping the selected month in context. */
function reportsLink(params) {
  return { search: `?${new URLSearchParams(params).toString()}` };
}

function shortDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Chevron() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

/**
 * Reports › Overview: a look back at the selected month (or year to date).
 * What you kept, how it compares with recent months, what moved, what needs
 * attention, the biggest transactions, and the needs/wants/savings mix.
 * Plan status ("left in plan") stays on Budgets; balances and upcoming bills
 * stay on Accounts.
 *
 * @param {{ month: number, year: number, viewMode: 'monthly' | 'ytd', asOf: string | null }} props
 */
export default function Overview({ month, year, viewMode, asOf }) {
  const isYtd = viewMode === 'ytd';
  const periodKeys = useMemo(() => reportPeriodKeys(year, month, viewMode), [year, month, viewMode]);
  // Monthly: last month and the 3-month average. YTD: the same months last year.
  const comparisons = useMemo(() => (isYtd
    ? [{ mode: 'lastYear', label: 'Last year', ...comparisonPeriod(year, month, viewMode, 'lastYear') }]
    : [
      { mode: 'lastMonth', label: 'Last month', ...comparisonPeriod(year, month, viewMode, 'lastMonth') },
      { mode: 'avg3', label: '3-mo average', ...comparisonPeriod(year, month, viewMode, 'avg3') },
    ]), [isYtd, year, month, viewMode]);
  const moverBasis = comparisons[comparisons.length - 1];

  const { settled, matrix, categories, budget, isLoading, failed } = useReportData({
    year,
    keyLists: [periodKeys, ...comparisons.map((c) => c.keys)],
    asOf,
    withBudget: true,
  });
  const pendingReviewCount = usePendingReviewCount().data ?? 0;

  const data = useMemo(() => {
    const summary = periodSummary(matrix, periodKeys);
    const compared = comparisons.map((c) => {
      const s = periodSummary(matrix, c.keys);
      return { ...c, spending: Math.round(s.spending / c.divisor), income: Math.round(s.income / c.divisor) };
    });
    const actual = categoryTotals(matrix, periodKeys);
    const basisTotals = categoryTotals(matrix, moverBasis.keys, moverBasis.divisor);
    const hasHistory = Object.keys(basisTotals).length > 0;
    return {
      summary,
      compared,
      hasHistory,
      movers: topMovers({ actual, compare: basisTotals, categories, meta: matrix.meta }),
      largest: largestTransactions(settled, periodKeys, 5, { excludeBills: true }),
      plan: planStatus({ actual, planned: plannedByCategory(budget, periodKeys, year), categories, meta: matrix.meta }),
    };
  }, [matrix, periodKeys, comparisons, moverBasis, categories, settled, budget, year]);

  const periodLabel = isYtd ? `Jan – ${getMonthName(month)} ${year}` : `${getMonthName(month)} ${year}`;

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="h-48 animate-pulse rounded-2xl bg-forest/85" />
        <div className="grid gap-6 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className={`h-56 animate-pulse ${PANEL}`} />)}
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <DataUnavailable
        eyebrow={periodLabel}
        title="Overview unavailable"
        message="Couldn't load transactions for this period, so no totals are shown."
        onRetry={() => failed.refetch()}
        retrying={failed.isFetching}
      />
    );
  }

  const { summary, compared, hasHistory, movers, largest, plan } = data;
  const kept = summary.saved >= 0;
  const ratePct = summary.savingsRate == null ? null : Math.round(summary.savingsRate * 100);
  const mixTotal = MIX.reduce((s, m) => s + Math.max(summary[m.type], 0), 0);
  const categoryName = (id) => categories.find((c) => c.id === id)?.name ?? matrix.meta[id]?.name ?? 'Uncategorized';

  const attention = [
    pendingReviewCount > 0 && {
      key: 'pending',
      to: '/app/transactions?status=pending',
      text: `${pendingReviewCount} ${pendingReviewCount === 1 ? 'transaction needs' : 'transactions need'} review`,
    },
    plan.overCount > 0 && {
      key: 'over',
      to: reportsLink({ view: 'categories', compare: 'plan', ...(plan.overCount === 1 ? { category: plan.overIds[0] } : {}) }),
      text: plan.overCount === 1
        ? `${categoryName(plan.overIds[0])} is over plan`
        : `${plan.overCount} categories over plan`,
    },
    plan.unbudgetedSpend > 0 && {
      key: 'unbudgeted',
      to: '/app/budgets',
      text: `${money(plan.unbudgetedSpend)} spent in ${plan.unbudgetedCount} unbudgeted ${plan.unbudgetedCount === 1 ? 'category' : 'categories'}`,
    },
  ].filter(Boolean);

  return (
    <div className="animate-fade-in space-y-6">
      {/* Hero: what you kept */}
      <section
        aria-label="Period summary"
        className="flex flex-col gap-6 rounded-2xl bg-forest p-6 text-[#fbfcf2] shadow-lg shadow-stone-900/10 sm:flex-row sm:items-end sm:justify-between sm:p-7"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d8e9d8]">
            {kept ? 'Kept' : 'Overspent'} {isYtd ? `so far in ${year}` : `in ${getMonthName(month)}`}
          </p>
          <p className="mt-1.5 font-display text-5xl font-normal leading-none tracking-tight sm:text-6xl">
            {money(Math.abs(summary.saved))}
          </p>
          <p className="mt-2 text-sm text-[#daeadc]">
            {ratePct == null ? 'No income recorded' : `${ratePct}% of income`}
            {summary.savings !== 0 && <> · {money(summary.savings)} to savings</>}
            {summary.savings !== 0 && <> · {money(summary.leftOver)} left over</>}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-6 text-sm">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d8e9d8]">Income</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{money(summary.income)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d8e9d8]">Spending</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{money(summary.spending)}</dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Compared with */}
        <section className={PANEL} aria-labelledby="overview-compared">
          <h2 id="overview-compared" className={PANEL_TITLE}>Compared with</h2>
          <p className={PANEL_SUB}>Spending excludes savings and transfers.</p>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">
                <th scope="col" className="pb-2 font-semibold"><span className="sr-only">Comparison</span></th>
                <th scope="col" className="pb-2 text-right font-semibold">Spending</th>
                <th scope="col" className="pb-2 text-right font-semibold">Income</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200/60 dark:divide-stone-700/60">
              {compared.map((c) => (
                <tr key={c.mode}>
                  <th scope="row" className="py-2.5 text-left font-medium text-stone-700 dark:text-stone-300">{c.label}</th>
                  <td className="py-2.5 text-right">
                    <div className="tabular-nums text-stone-900 dark:text-stone-100">{money(c.spending)}</div>
                    <ChangeChip actual={summary.spending} compare={c.spending} emptyLabel="No data" />
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="tabular-nums text-stone-900 dark:text-stone-100">{money(c.income)}</div>
                    <ChangeChip actual={summary.income} compare={c.income} isIncome emptyLabel="No data" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Needs attention */}
        <section className={PANEL} aria-labelledby="overview-attention">
          <h2 id="overview-attention" className={PANEL_TITLE}>Needs attention</h2>
          <p className={PANEL_SUB}>{periodLabel}</p>
          {attention.length === 0 ? (
            <p className="mt-6 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              All clear
            </p>
          ) : (
            <ul className="mt-3 space-y-1">
              {attention.map((item) => (
                <li key={item.key}>
                  <Link to={item.to} className={ROW_LINK}>
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                    <span className="flex-1 text-sm text-stone-800 dark:text-stone-200">{item.text}</span>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Top movers */}
        <section className={PANEL} aria-labelledby="overview-movers">
          <h2 id="overview-movers" className={PANEL_TITLE}>Top movers</h2>
          <p className={PANEL_SUB}>{isYtd ? 'vs the same months last year' : 'vs your 3-month average'}</p>
          {!hasHistory ? (
            <p className="mt-6 text-sm text-stone-500 dark:text-stone-400">Not enough history yet to compare.</p>
          ) : movers.length === 0 ? (
            <p className="mt-6 text-sm text-stone-500 dark:text-stone-400">No category moved by more than $10.</p>
          ) : (
            <ul className="mt-3 space-y-1">
              {movers.map((row) => (
                <li key={row.categoryId}>
                  <Link to={reportsLink({ view: 'categories', category: row.categoryId, compare: moverBasis.mode })} className={ROW_LINK}>
                    <CategoryWell category={{ name: row.name, color: row.color }} className="h-8 w-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-stone-900 dark:text-stone-100">{row.name}</span>
                      <span className="block text-xs tabular-nums text-stone-500 dark:text-stone-400">
                        {money(row.actual)} vs {money(row.compare)}
                      </span>
                    </span>
                    <ChangeChip actual={row.actual} compare={row.compare} />
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Largest transactions */}
        <section className={PANEL} aria-labelledby="overview-largest">
          <h2 id="overview-largest" className={PANEL_TITLE}>Largest purchases</h2>
          <p className={PANEL_SUB}>Excludes recurring bills · open one to see its category</p>
          {largest.length === 0 ? (
            <p className="mt-6 text-sm text-stone-500 dark:text-stone-400">No one-off spending recorded.</p>
          ) : (
            <ul className="mt-3 space-y-1">
              {largest.map((tx) => (
                <li key={tx.id}>
                  <Link to={reportsLink({ view: 'categories', category: tx.category_id })} className={ROW_LINK}>
                    <CategoryWell category={tx.categories} className="h-8 w-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-stone-900 dark:text-stone-100">{tx.payee || tx.description}</span>
                      <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                        {shortDate(tx.transaction_date)} · {tx.categories?.name ?? 'Uncategorized'}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                      {formatCurrency(Math.abs(tx.amount))}
                    </span>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Needs / wants / savings mix */}
      {mixTotal > 0 ? (
        <section className={PANEL} aria-labelledby="overview-mix">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="overview-mix" className={PANEL_TITLE}>Where it went</h2>
            <Link to={reportsLink({ view: 'trends' })} className="text-xs font-semibold text-violet-700 hover:underline dark:text-violet-400">
              See trends
            </Link>
          </div>
          <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700" aria-hidden="true">
            {MIX.map((m) => {
              const value = Math.max(summary[m.type], 0);
              return value > 0 ? <div key={m.type} className={m.bar} style={{ width: `${(value / mixTotal) * 100}%` }} /> : null;
            })}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            {MIX.map((m) => (
              <div key={m.type}>
                <dt className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${m.bar}`} />
                  {m.label}
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                  {money(summary[m.type])}
                  <span className="ml-1.5 text-xs font-normal text-stone-500 dark:text-stone-400">
                    {Math.round((Math.max(summary[m.type], 0) / mixTotal) * 100)}%
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        summary.income === 0 && <EmptyState title="Nothing recorded yet" hint={`No income or spending for ${periodLabel}.`} />
      )}
    </div>
  );
}
