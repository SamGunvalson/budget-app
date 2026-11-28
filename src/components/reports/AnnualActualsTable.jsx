import { useCallback, useMemo, useState, Fragment } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Modal from '../common/Modal';
import CategoryDrillDown from './CategoryDrillDown';
import { drillDownTransactions, monthKey, txMonthKey } from '../../utils/reportAggregations';
import {
  formatCurrency,
  getMonthName,
  isTrueIncome,
  isSpendingCredit,
  isIncomeDebit,
  isSettledTransaction,
} from '../../utils/helpers';
import useMonthYear from '../../hooks/useMonthYear';
import { percentUsed, alertLevel } from '../../utils/budgetCalculations';
import useThresholds from '../../hooks/useThresholds';
import { budgetCategoryIds } from '../../utils/categoryArchive';
import {
  useAnnualBudgetData,
  useCategories,
  useTransactionsForYear,
  useUserPreference,
} from '../../hooks/queries';
import { TYPE_HEADER_STYLES } from '../../constants/typeStyles';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const SHORT_MONTHS = MONTHS.map((m) =>
  new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }),
);

const DEFAULT_TYPE_ORDER = ['income', 'needs', 'wants', 'savings'];

// Type colors live in one place: constants/typeStyles.js.
const TYPE_STYLES = TYPE_HEADER_STYLES;

/**
 * Returns Tailwind classes for a cell based on threshold alert level.
 * Only applies to expense categories (needs/wants/savings).
 */
function getCellHighlight(actualCents, plannedCents, thresholds, categoryType) {
  // Income categories: no threshold highlighting
  if (categoryType === 'income') return '';

  // No budget exists for this cell → neutral indicator
  if (plannedCents === undefined || plannedCents === null) {
    if (actualCents > 0) {
      return 'bg-stone-100/50 dark:bg-stone-700/30 text-stone-600 dark:text-stone-300 italic';
    }
    return '';
  }

  // Both zero — nothing to highlight
  if (actualCents === 0 && plannedCents === 0) return '';

  // No budget set (0) but has actual spending → neutral indicator
  if (plannedCents === 0 && actualCents > 0) {
    return 'bg-stone-100/50 dark:bg-stone-700/30 text-stone-600 dark:text-stone-300 italic';
  }

  const pct = percentUsed(actualCents, plannedCents);
  const level = alertLevel(pct, thresholds);

  switch (level) {
    case 'danger':
      return 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300';
    case 'warning':
      return 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300';
    case 'underBudget':
      return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300';
    default:
      return '';
  }
}

/**
 * Annual Actuals Table — read-only 12-month-by-category grid showing actual
 * transaction totals with threshold-based highlighting against budget plans.
 *
 * Mirrors the AnnualBudgetTable grid layout (sticky header/footer/left column,
 * type-group sections, annual totals column).
 *
 * `asOf` (YYYY-MM-DD) limits actuals to posted transactions dated on or
 * before it; null/omitted counts every live transaction.
 */
export default function AnnualActualsTable({ year: yearProp, asOf = null }) {
  const { year: ctxYear } = useMonthYear();
  const year = yearProp ?? ctxYear;
  const { thresholds } = useThresholds();
  const transactionsQuery = useTransactionsForYear(year);
  const transactions = useMemo(
    () => (transactionsQuery.data ?? []).filter((tx) => isSettledTransaction(tx, asOf)),
    [transactionsQuery.data, asOf],
  );

  // Cell drill-down: { categoryId, month } of the open cell, or null. Edits
  // update the year query cache optimistically, as the other drill-downs do.
  const queryClient = useQueryClient();
  const [openCell, setOpenCell] = useState(null);
  const setYearTransactions = useCallback((updater) => {
    queryClient.setQueryData(['transactions', 'year', year], (prev) =>
      typeof updater === 'function' ? updater(prev ?? []) : updater,
    );
  }, [queryClient, year]);
  const cellTransactions = useMemo(() => {
    if (!openCell) return [];
    const key = monthKey(year, openCell.month);
    return drillDownTransactions(transactions, openCell.categoryId).filter((tx) => txMonthKey(tx) === key);
  }, [openCell, transactions, year]);
  const categoriesQuery = useCategories();
  const typeOrderQuery = useUserPreference('type_group_order');
  const budgetQuery = useAnnualBudgetData(year);
  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  const savedTypeOrder = typeOrderQuery.data;
  const typeOrder = useMemo(() => {
    if (!Array.isArray(savedTypeOrder)) return DEFAULT_TYPE_ORDER;
    const validTypes = new Set(DEFAULT_TYPE_ORDER);
    const filtered = savedTypeOrder.filter((type) => validTypes.has(type));
    return [
      ...filtered,
      ...DEFAULT_TYPE_ORDER.filter((type) => !filtered.includes(type)),
    ];
  }, [savedTypeOrder]);
  const actualData = useMemo(() => {
    const actuals = Object.fromEntries(MONTHS.map((month) => [month, {}]));
    for (const tx of transactions) {
      if (tx.categories?.type === 'transfer') continue;

      const date = new Date(`${tx.transaction_date}T00:00:00`);
      const month = date.getMonth() + 1;
      const categoryId = tx.category_id;
      if (!categoryId || !actuals[month]) continue;

      if (!actuals[month][categoryId]) actuals[month][categoryId] = 0;
      if (isTrueIncome(tx)) actuals[month][categoryId] += Math.abs(tx.amount);
      // Debit in an income category (e.g. a refunded paycheck) reduces income
      else if (isIncomeDebit(tx)) actuals[month][categoryId] -= Math.abs(tx.amount);
      else if (isSpendingCredit(tx)) actuals[month][categoryId] -= Math.abs(tx.amount);
      else actuals[month][categoryId] += Math.abs(tx.amount);
    }
    return actuals;
  }, [transactions]);
  const budgetData = budgetQuery.data ?? {};

  // Months after the current calendar month haven't happened yet: fade them
  // and skip budget highlighting so empty or projected cells don't read as
  // "under budget".
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const isFutureMonth = (m) =>
    year > currentYear || (year === currentYear && m > currentMonth);
  const futureClass = (m) => (isFutureMonth(m) ? 'opacity-40' : '');

  // Average over elapsed months (completed months plus the current one).
  const elapsedMonths = MONTHS.filter((m) => !isFutureMonth(m));
  const averageOf = (valueForMonth) =>
    elapsedMonths.length === 0
      ? null
      : Math.round(
          elapsedMonths.reduce((s, m) => s + valueForMonth(m), 0) / elapsedMonths.length,
        );
  const formatAverage = (cents) =>
    cents === null || cents === 0
      ? <span className="opacity-30">–</span>
      : formatCurrency(cents, 'USD', { hideCents: true });
  const averageTitle = elapsedMonths.length === 0
    ? 'No completed months yet'
    : `Average of ${SHORT_MONTHS[0]}–${SHORT_MONTHS[elapsedMonths.length - 1]} (${elapsedMonths.length} month${elapsedMonths.length === 1 ? '' : 's'})`;
  const isLoading = [
    transactionsQuery,
    categoriesQuery,
    typeOrderQuery,
    budgetQuery,
  ].some((query) => query.isLoading);
  const error = [
    transactionsQuery.error,
    categoriesQuery.error,
    typeOrderQuery.error,
    budgetQuery.error,
  ].find(Boolean)?.message || '';

  // ── Group categories by type (exclude transfers) ──
  const activityIds = new Set([
    ...transactions.map((tx) => tx.category_id),
    ...budgetCategoryIds(budgetData),
  ]);
  const budgetableCategories = categories.filter((c) =>
    c.type !== 'transfer' && (!c.is_archived || activityIds.has(c.id)),
  );

  const grouped = useMemo(() => {
    const g = {};
    typeOrder.forEach((t) => { g[t] = []; });
    budgetableCategories.forEach((c) => {
      if (g[c.type]) g[c.type].push(c);
    });
    Object.values(g).forEach((arr) => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    return g;
  }, [budgetableCategories, typeOrder]);

  // ── Per-type monthly subtotals { [type]: { [month]: cents } } ──
  const groupSubtotals = useMemo(() => {
    const result = {};
    typeOrder.forEach((type) => {
      result[type] = {};
      MONTHS.forEach((m) => {
        result[type][m] = (grouped[type] || []).reduce(
          (sum, cat) => sum + (actualData[m]?.[cat.id] || 0),
          0,
        );
      });
    });
    return result;
  }, [typeOrder, grouped, actualData]);

  const incomeCatIds = useMemo(
    () => new Set(categories.filter((c) => c.type === 'income').map((c) => c.id)),
    [categories],
  );
  const transferCatIds = useMemo(
    () => new Set(categories.filter((c) => c.type === 'transfer').map((c) => c.id)),
    [categories],
  );

  // ── Footer totals ──
  const getMonthIncome = (m) => {
    if (!actualData[m]) return 0;
    return Object.entries(actualData[m])
      .filter(([id]) => incomeCatIds.has(id))
      .reduce((s, [, v]) => s + (v || 0), 0);
  };

  const getMonthExpenses = (m) => {
    if (!actualData[m]) return 0;
    return Object.entries(actualData[m])
      .filter(([id]) => !incomeCatIds.has(id) && !transferCatIds.has(id))
      .reduce((s, [, v]) => s + (v || 0), 0);
  };

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {/* Table skeleton */}
        <div className="h-96 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Legend (the year picker lives in the Reports control row) */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-4 text-[10px] text-stone-500 dark:text-stone-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/40" />
            Under budget (&lt;{thresholds.underBudget}%)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-orange-300 bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40" />
            Warning ({thresholds.warning}%+)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-red-300 bg-red-100 dark:border-red-700 dark:bg-red-900/40" />
            Over ({thresholds.danger}%+)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-800" />
            Within range ({thresholds.underBudget}%–&lt;{thresholds.warning}%)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-stone-300 bg-stone-100/50 dark:border-stone-600 dark:bg-stone-700/30" />
            <span className="italic">No budget / zero allocation</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-stone-300 bg-white opacity-40 dark:border-stone-600 dark:bg-stone-800" />
            Upcoming month (not highlighted)
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <span className="mr-1.5">&#9888;</span>{error}
        </div>
      )}

      {/* Empty state */}
      {!error && budgetableCategories.length === 0 && (
        <div className="rounded-2xl border border-stone-200/60 bg-white p-12 text-center shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
          <p className="text-stone-500 dark:text-stone-400">No categories found. Create categories first to view actuals.</p>
        </div>
      )}

      {/* Table */}
      {!error && budgetableCategories.length > 0 && (
        <div
          className="overflow-y-auto overflow-x-auto rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50"
          style={{ maxHeight: 'calc(100vh - 300px)' }}
        >
          <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: '970px' }}>
            <thead className="sticky top-0 z-20 bg-stone-50 shadow-sm dark:bg-stone-900">
              <tr className="border-b border-stone-200 dark:border-stone-700">
                <th
                  className="sticky left-0 z-30 bg-stone-50 px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:bg-stone-900 dark:text-stone-400"
                  style={{ minWidth: '130px' }}
                >
                  Category
                </th>
                {MONTHS.map((m, i) => (
                  <th
                    key={m}
                    className={`px-0.5 py-2 text-center text-[10px] font-semibold uppercase text-stone-500 dark:text-stone-400 ${futureClass(m)}`}
                    style={{ minWidth: '52px' }}
                    title={isFutureMonth(m) ? 'Upcoming month' : undefined}
                  >
                    {SHORT_MONTHS[i]}
                  </th>
                ))}
                <th
                  className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400"
                  style={{ minWidth: '70px' }}
                >
                  Annual
                </th>
                <th
                  className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400"
                  style={{ minWidth: '70px' }}
                  title={averageTitle}
                >
                  Avg
                </th>
              </tr>
            </thead>

            {/* Type groups */}
            {typeOrder.map((type) => {
              const cats = grouped[type];
              if (!cats || cats.length === 0) return null;
              const typeStyle = TYPE_STYLES[type];
              if (!typeStyle) return null;

              return (
                <Fragment key={type}>
                  <tbody>
                    {/* Type group header */}
                    <tr className={typeStyle.headerBg}>
                      <td
                        className={`sticky left-0 z-10 border-t ${typeStyle.headerBorder} ${typeStyle.stickyBg} px-2 py-1.5`}
                      >
                        <span className={`text-xs font-bold uppercase tracking-wider ${typeStyle.headerText}`}>
                          {typeStyle.label}
                        </span>
                      </td>
                      {MONTHS.map((m) => {
                          const val = groupSubtotals[type]?.[m] || 0;
                          return (
                            <td
                              key={m}
                              className={`border-t ${typeStyle.headerBorder} ${typeStyle.headerBg} px-0.5 py-1.5 text-center text-[11px] font-bold ${typeStyle.headerText}`}
                            >
                              <span className={futureClass(m)}>
                              {val === 0 ? <span className="opacity-30">–</span> : formatCurrency(val, 'USD', { hideCents: true })}
                              </span>
                            </td>
                          );
                        })}
                      <td className={`border-t ${typeStyle.headerBorder} ${typeStyle.headerBg} px-2 py-1.5 text-right text-[11px] font-bold ${typeStyle.headerText}`}>
                        {(() => {
                          const annual = MONTHS.reduce((s, m) => s + (groupSubtotals[type]?.[m] || 0), 0);
                          return annual === 0 ? <span className="opacity-30">–</span> : formatCurrency(annual, 'USD', { hideCents: true });
                        })()}
                      </td>
                      <td className={`border-t ${typeStyle.headerBorder} ${typeStyle.headerBg} px-2 py-1.5 text-right text-[11px] font-bold ${typeStyle.headerText}`}>
                        {formatAverage(averageOf((m) => groupSubtotals[type]?.[m] || 0))}
                      </td>
                    </tr>

                    {/* Category rows */}
                    {cats.map((cat) => {
                      const annualTotal = MONTHS.reduce(
                        (sum, m) => sum + (actualData[m]?.[cat.id] || 0),
                        0,
                      );

                      return (
                        <tr
                          key={cat.id}
                          className="border-t border-stone-100 hover:bg-stone-50 dark:border-stone-700/50 dark:hover:bg-stone-700/20"
                        >
                          {/* Category name (sticky) */}
                          <td className="sticky left-0 z-10 bg-white px-2 py-1.5 dark:bg-stone-800">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: cat.color }}
                              />
                              <span className="max-w-[120px] truncate text-xs font-medium text-stone-800 dark:text-stone-200">
                                {cat.name}{cat.is_archived ? ' (Archived)' : ''}
                              </span>
                            </div>
                          </td>

                          {/* Month cells */}
                          {MONTHS.map((m) => {
                            const actualCents = actualData[m]?.[cat.id] || 0;
                            const plannedCents = budgetData[m]?.allocations?.[cat.id];
                            const highlight = isFutureMonth(m)
                              ? ''
                              : getCellHighlight(actualCents, plannedCents, thresholds, cat.type);

                            return (
                              <td
                                key={m}
                                className={`px-0.5 py-1 text-center text-[11px] ${highlight} ${futureClass(m)}`}
                              >
                                {actualCents === 0 ? (
                                  <span className="text-stone-300 dark:text-stone-600">
                                    {formatCurrency(actualCents, 'USD', { hideCents: true })}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setOpenCell({ categoryId: cat.id, month: m })}
                                    aria-label={`${cat.name}, ${getMonthName(m)}: view transactions`}
                                    className={`w-full rounded px-0.5 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${!highlight ? 'text-stone-800 dark:text-stone-200' : ''}`}
                                  >
                                    {formatCurrency(actualCents, 'USD', { hideCents: true })}
                                  </button>
                                )}
                              </td>
                            );
                          })}

                          {/* Annual total */}
                          <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                            {formatCurrency(annualTotal, 'USD', { hideCents: true })}
                          </td>

                          {/* Average over elapsed months */}
                          <td className="px-2 py-1.5 text-right text-[11px] font-medium text-stone-600 dark:text-stone-400">
                            {formatAverage(averageOf((m) => actualData[m]?.[cat.id] || 0))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Fragment>
              );
            })}

            {/* Footer totals */}
            <tfoot className="sticky bottom-0 z-20 bg-stone-50 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] dark:bg-stone-900">
              {/* Income row */}
              <tr className="border-t-2 border-stone-300 dark:border-stone-600">
                <td className="sticky left-0 z-30 bg-stone-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-600 dark:bg-stone-900 dark:text-stone-400">
                  Income
                </td>
                {MONTHS.map((m) => (
                  <td key={m} className={`px-0.5 py-1.5 text-center text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 ${futureClass(m)}`}>
                    {formatCurrency(getMonthIncome(m), 'USD', { hideCents: true })}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(MONTHS.reduce((s, m) => s + getMonthIncome(m), 0), 'USD', { hideCents: true })}
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                  {formatAverage(averageOf(getMonthIncome))}
                </td>
              </tr>

              {/* Expenses row */}
              <tr>
                <td className="sticky left-0 z-30 bg-stone-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-600 dark:bg-stone-900 dark:text-stone-400">
                  Expenses
                </td>
                {MONTHS.map((m) => (
                  <td key={m} className={`px-0.5 py-1.5 text-center text-[11px] font-semibold text-stone-700 dark:text-stone-300 ${futureClass(m)}`}>
                    {formatCurrency(getMonthExpenses(m), 'USD', { hideCents: true })}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-stone-700 dark:text-stone-300">
                  {formatCurrency(MONTHS.reduce((s, m) => s + getMonthExpenses(m), 0), 'USD', { hideCents: true })}
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-stone-700 dark:text-stone-300">
                  {formatAverage(averageOf(getMonthExpenses))}
                </td>
              </tr>

              {/* Remaining row */}
              <tr>
                <td className="sticky left-0 z-30 bg-stone-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-600 dark:bg-stone-900 dark:text-stone-400">
                  Remaining
                </td>
                {MONTHS.map((m) => {
                  const rem = getMonthIncome(m) - getMonthExpenses(m);
                  return (
                    <td
                      key={m}
                      className={`px-0.5 py-1.5 text-center text-[11px] font-semibold ${rem >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} ${futureClass(m)}`}
                    >
                      {formatCurrency(rem, 'USD', { hideCents: true })}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right text-[11px] font-bold">
                  {(() => {
                    const total = MONTHS.reduce(
                      (s, m) => s + getMonthIncome(m) - getMonthExpenses(m),
                      0,
                    );
                    return (
                      <span className={total >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                        {formatCurrency(total, 'USD', { hideCents: true })}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] font-bold">
                  {(() => {
                    const avg = averageOf((m) => getMonthIncome(m) - getMonthExpenses(m));
                    if (avg === null) return <span className="opacity-30">–</span>;
                    return (
                      <span className={avg >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                        {formatCurrency(avg, 'USD', { hideCents: true })}
                      </span>
                    );
                  })()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {openCell && (() => {
        const cat = categories.find((c) => c.id === openCell.categoryId);
        return (
          <Modal title={`${cat?.name ?? 'Category'} · ${getMonthName(openCell.month)} ${year}`} onClose={() => setOpenCell(null)} wide>
            <CategoryDrillDown
              transactions={cellTransactions}
              categories={categories}
              categoryName={cat?.name ?? 'Category'}
              categoryColor={cat?.color}
              onClose={() => setOpenCell(null)}
              onDataChanged={() => {}}
              setAllTransactions={setYearTransactions}
              embedded
            />
          </Modal>
        );
      })()}
    </div>
  );
}
