import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { getTransactionsForYear } from '../../services/transactions';
import { getCategoriesOffline as getCategories } from '../../services/offlineAware';
import { getUserPreference } from '../../services/categories';
import { getBudgetPlansForYear, getBudgetItems } from '../../services/budgets';
import { formatCurrency, isTrueIncome, isSpendingCredit } from '../../utils/helpers';
import useMonthYear from '../../hooks/useMonthYear';
import { percentUsed, alertLevel } from '../../utils/budgetCalculations';
import useThresholds from '../../hooks/useThresholds';
import useAvailableYears from '../../hooks/useAvailableYears';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const SHORT_MONTHS = MONTHS.map((m) =>
  new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }),
);

const DEFAULT_TYPE_ORDER = ['income', 'needs', 'wants', 'savings'];

const TYPE_STYLES = {
  income: {
    label: 'Income',
    headerBg: 'bg-emerald-50 dark:bg-emerald-900/30',
    stickyBg: 'bg-emerald-50 dark:bg-emerald-950',
    headerText: 'text-emerald-800 dark:text-emerald-300',
    headerBorder: 'border-emerald-200/60 dark:border-emerald-700/60',
  },
  needs: {
    label: 'Needs',
    headerBg: 'bg-red-50 dark:bg-red-900/30',
    stickyBg: 'bg-red-50 dark:bg-red-950',
    headerText: 'text-red-800 dark:text-red-300',
    headerBorder: 'border-red-200/60 dark:border-red-700/60',
  },
  wants: {
    label: 'Wants',
    headerBg: 'bg-pink-50 dark:bg-pink-900/30',
    stickyBg: 'bg-pink-50 dark:bg-pink-950',
    headerText: 'text-pink-800 dark:text-pink-300',
    headerBorder: 'border-pink-200/60 dark:border-pink-700/60',
  },
  savings: {
    label: 'Savings',
    headerBg: 'bg-teal-50 dark:bg-teal-900/30',
    stickyBg: 'bg-teal-50 dark:bg-teal-950',
    headerText: 'text-teal-800 dark:text-teal-300',
    headerBorder: 'border-teal-200/60 dark:border-teal-700/60',
  },
};

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
      return 'bg-stone-100/50 dark:bg-stone-700/30 italic';
    }
    return '';
  }

  // Both zero — nothing to highlight
  if (actualCents === 0 && plannedCents === 0) return '';

  // No budget set (0) but has actual spending → neutral indicator
  if (plannedCents === 0 && actualCents > 0) {
    return 'bg-stone-100/50 dark:bg-stone-700/30 italic';
  }

  const pct = percentUsed(actualCents, plannedCents);
  const level = alertLevel(pct, thresholds);

  switch (level) {
    case 'danger':
      return 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300';
    case 'warning':
      return 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300';
    case 'underBudget':
      return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300';
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
 */
export default function AnnualActualsTable({ year: yearProp }) {
  const { month: ctxMonth, year: ctxYear, setMonthYear } = useMonthYear();
  const [year, setYear] = useState(yearProp || ctxYear);
  const [categories, setCategories] = useState([]);
  const [typeOrder, setTypeOrder] = useState(DEFAULT_TYPE_ORDER);
  const [actualData, setActualData] = useState({}); // { [month]: { [categoryId]: cents } }
  const [budgetData, setBudgetData] = useState({}); // { [month]: { [categoryId]: cents } }
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const { thresholds } = useThresholds();

  const { years } = useAvailableYears();

  // Sync with parent prop when it changes
  useEffect(() => {
    if (yearProp && yearProp !== year) setYear(yearProp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearProp]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [transactions, cats, plans, savedTypeOrder] = await Promise.all([
        getTransactionsForYear({ year }),
        getCategories(),
        getBudgetPlansForYear(year),
        getUserPreference('type_group_order').catch(() => null),
      ]);

      setCategories(cats);

      // Restore saved type order
      if (savedTypeOrder && Array.isArray(savedTypeOrder)) {
        const validTypes = new Set(DEFAULT_TYPE_ORDER);
        const filtered = savedTypeOrder.filter((t) => validTypes.has(t));
        const missing = DEFAULT_TYPE_ORDER.filter((t) => !filtered.includes(t));
        setTypeOrder([...filtered, ...missing]);
      }

      // ── Aggregate transactions into { [month]: { [categoryId]: cents } } ──
      const actuals = {};
      MONTHS.forEach((m) => { actuals[m] = {}; });

      for (const tx of transactions) {
        if (tx.categories?.type === 'transfer') continue;

        const d = new Date(tx.transaction_date);
        const m = d.getUTCMonth() + 1;
        const catId = tx.category_id;
        if (!catId || !actuals[m]) continue;

        if (!actuals[m][catId]) actuals[m][catId] = 0;

        if (isTrueIncome(tx)) {
          // True income: add as positive
          actuals[m][catId] += Math.abs(tx.amount);
        } else if (isSpendingCredit(tx)) {
          // Spending credit: reduce that category's expense total
          actuals[m][catId] -= Math.abs(tx.amount);
        } else {
          // Normal expense
          actuals[m][catId] += Math.abs(tx.amount);
        }
      }

      setActualData(actuals);

      // ── Build budget lookup { [month]: { [categoryId]: plannedCents } } ──
      const budgets = {};
      const planItems = await Promise.all(
        plans.map(async (p) => {
          const items = await getBudgetItems(p.id);
          return { month: p.month, items };
        }),
      );
      planItems.forEach(({ month: m, items }) => {
        budgets[m] = {};
        items.forEach((item) => {
          budgets[m][item.category_id] = item.planned_amount;
        });
      });

      setBudgetData(budgets);
    } catch (err) {
      setError(err.message || 'Failed to load annual actuals data');
    } finally {
      setIsLoading(false);
    }
  }, [year]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Group categories by type (exclude transfers) ──
  const budgetableCategories = categories.filter((c) => c.type !== 'transfer');

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
        {/* Year selector skeleton */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-lg bg-stone-200 dark:bg-stone-700" />
          <div className="h-10 w-24 animate-pulse rounded-xl bg-stone-200 dark:bg-stone-700" />
          <div className="h-10 w-10 animate-pulse rounded-lg bg-stone-200 dark:bg-stone-700" />
        </div>
        {/* Table skeleton */}
        <div className="h-96 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Year selector */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { const ny = year - 1; setYear(ny); setMonthYear(ctxMonth, ny); }}
          className="rounded-lg border border-violet-200 bg-white p-2 text-stone-500 shadow-sm transition-all hover:bg-stone-50 hover:text-stone-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:border-violet-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-300"
          aria-label="Previous year"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>

        <select
          value={year}
          onChange={(e) => { const ny = Number(e.target.value); setYear(ny); setMonthYear(ctxMonth, ny); }}
          className="rounded-xl border border-violet-300 bg-stone-50/50 px-4 py-2 text-sm font-semibold text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-violet-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => { const ny = year + 1; setYear(ny); setMonthYear(ctxMonth, ny); }}
          className="rounded-lg border border-violet-200 bg-white p-2 text-stone-500 shadow-sm transition-all hover:bg-stone-50 hover:text-stone-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:border-violet-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-300"
          aria-label="Next year"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        {/* Legend */}
        <div className="ml-auto flex flex-wrap items-center gap-4 text-[10px] text-stone-500 dark:text-stone-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20" />
            Under budget (&lt;{thresholds.underBudget}%)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20" />
            Warning ({thresholds.warning}%+)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20" />
            Over ({thresholds.danger}%+)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-stone-300 bg-stone-100/50 dark:border-stone-600 dark:bg-stone-700/30" />
            On budget
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
          <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: '900px' }}>
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
                    className="px-0.5 py-2 text-center text-[10px] font-semibold uppercase text-stone-500 dark:text-stone-400"
                    style={{ minWidth: '52px' }}
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
                              {val === 0 ? <span className="opacity-30">–</span> : formatCurrency(val, 'USD', { hideCents: true })}
                            </td>
                          );
                        })}
                      <td className={`border-t ${typeStyle.headerBorder} ${typeStyle.headerBg} px-2 py-1.5 text-right text-[11px] font-bold ${typeStyle.headerText}`}>
                        {(() => {
                          const annual = MONTHS.reduce((s, m) => s + (groupSubtotals[type]?.[m] || 0), 0);
                          return annual === 0 ? <span className="opacity-30">–</span> : formatCurrency(annual, 'USD', { hideCents: true });
                        })()}
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
                          className="border-t border-stone-100 hover:bg-amber-50/30 dark:border-stone-700/50 dark:hover:bg-amber-900/10"
                        >
                          {/* Category name (sticky) */}
                          <td className="sticky left-0 z-10 bg-white px-2 py-1.5 dark:bg-stone-800">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: cat.color }}
                              />
                              <span className="max-w-[120px] truncate text-xs font-medium text-stone-800 dark:text-stone-200">
                                {cat.name}
                              </span>
                            </div>
                          </td>

                          {/* Month cells */}
                          {MONTHS.map((m) => {
                            const actualCents = actualData[m]?.[cat.id] || 0;
                            const plannedCents = budgetData[m]?.[cat.id];
                            const highlight = getCellHighlight(actualCents, plannedCents, thresholds, cat.type);

                            return (
                              <td
                                key={m}
                                className={`px-0.5 py-1 text-center text-[11px] ${highlight}`}
                              >
                                <span className={`${actualCents === 0 ? 'text-stone-300 dark:text-stone-600' : !highlight ? 'text-stone-800 dark:text-stone-200' : ''}`}>
                                  {formatCurrency(actualCents, 'USD', { hideCents: true })}
                                </span>
                              </td>
                            );
                          })}

                          {/* Annual total */}
                          <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                            {formatCurrency(annualTotal, 'USD', { hideCents: true })}
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
                  <td key={m} className="px-0.5 py-1.5 text-center text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(getMonthIncome(m), 'USD', { hideCents: true })}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(MONTHS.reduce((s, m) => s + getMonthIncome(m), 0), 'USD', { hideCents: true })}
                </td>
              </tr>

              {/* Expenses row */}
              <tr>
                <td className="sticky left-0 z-30 bg-stone-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-600 dark:bg-stone-900 dark:text-stone-400">
                  Expenses
                </td>
                {MONTHS.map((m) => (
                  <td key={m} className="px-0.5 py-1.5 text-center text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                    {formatCurrency(getMonthExpenses(m), 'USD', { hideCents: true })}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-stone-700 dark:text-stone-300">
                  {formatCurrency(MONTHS.reduce((s, m) => s + getMonthExpenses(m), 0), 'USD', { hideCents: true })}
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
                      className={`px-0.5 py-1.5 text-center text-[11px] font-semibold ${rem >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
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
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
