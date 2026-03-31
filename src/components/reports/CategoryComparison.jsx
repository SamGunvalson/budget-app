import { formatCurrency } from '../../utils/helpers';
import { categoryAlert } from '../../utils/budgetCalculations';

const TYPE_ORDER = ['income', 'needs', 'wants', 'savings'];

const TYPE_STYLES = {
  income: {
    label: 'Income',
    headerBg: 'bg-emerald-50 dark:bg-emerald-900/30',
    headerText: 'text-emerald-800 dark:text-emerald-300',
    headerBorder: 'border-emerald-200/60 dark:border-emerald-700/60',
  },
  needs: {
    label: 'Needs',
    headerBg: 'bg-red-50 dark:bg-red-900/30',
    headerText: 'text-red-800 dark:text-red-300',
    headerBorder: 'border-red-200/60 dark:border-red-700/60',
  },
  wants: {
    label: 'Wants',
    headerBg: 'bg-pink-50 dark:bg-pink-900/30',
    headerText: 'text-pink-800 dark:text-pink-300',
    headerBorder: 'border-pink-200/60 dark:border-pink-700/60',
  },
  savings: {
    label: 'Savings',
    headerBg: 'bg-teal-50 dark:bg-teal-900/30',
    headerText: 'text-teal-800 dark:text-teal-300',
    headerBorder: 'border-teal-200/60 dark:border-teal-700/60',
  },
};

/**
 * Per-category rows showing planned, actual, variance and % used.
 * Categories are grouped by type (Income → Needs → Wants → Savings).
 * Supports click-to-expand drill-down via onCategoryClick / expandedCategoryId.
 * Income categories (categoryType === 'income') use inverted variance semantics.
 */
export default function CategoryComparison({
  data,
  onCategoryClick,
  expandedCategoryId,
  renderDrillDown,
  thresholds,
}) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <h3 className="mb-4 text-lg font-semibold text-stone-900 dark:text-stone-100">
          Category Breakdown
        </h3>
        <p className="py-10 text-center text-sm text-stone-400 dark:text-stone-500">
          No budget or transaction data for this month.
        </p>
      </div>
    );
  }

  // Bucket data into type groups in display order
  const knownTypes = new Set(TYPE_ORDER);
  const groups = TYPE_ORDER.reduce((acc, type) => {
    const items = data.filter((d) => d.categoryType === type);
    if (items.length > 0) acc.push({ type, items });
    return acc;
  }, []);
  const otherItems = data.filter((d) => !knownTypes.has(d.categoryType));
  if (otherItems.length > 0) groups.push({ type: 'other', items: otherItems });

  let rowIndex = 0;

  return (
    <div className="animate-fade-in rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <h3 className="mb-5 text-lg font-semibold text-stone-900 dark:text-stone-100">
        Category Breakdown
      </h3>

      {/* Column header */}
      <div className="mb-1 grid grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">
        <div className="col-span-1" />
        <div className="col-span-5 sm:col-span-3">Category</div>
        <div className="col-span-2 text-right">Planned</div>
        <div className="col-span-2 text-right">Actual</div>
        <div className="col-span-2 text-right">Variance</div>
        <div className="hidden sm:block sm:col-span-2 text-right">Used</div>
      </div>

      {/* Type groups */}
      <div>
        {groups.map(({ type, items }, groupIdx) => {
          const style = TYPE_STYLES[type];
          return (
            <div key={type}>
              {/* Group header band */}
              {(() => {
                const isIncomeGroup = type === 'income';
                const groupPlanned = items.reduce((s, d) => s + d.planned, 0);
                const groupActual = items.reduce((s, d) => s + d.actual, 0);
                const groupVariance = groupActual - groupPlanned;
                const groupIsOver = groupVariance > 0;
                const groupVariantGood = isIncomeGroup ? groupIsOver : !groupIsOver;
                const groupPct = groupPlanned > 0 ? Math.round((groupActual / groupPlanned) * 100) : null;
                const labelClass = style ? style.headerText : 'text-stone-500 dark:text-stone-400';
                const bgBorderClass = style
                  ? `${style.headerBg} ${style.headerBorder}`
                  : 'border-stone-200/60 bg-stone-50 dark:border-stone-700/60 dark:bg-stone-700/30';

                return (
                  <div
                    className={`-mx-2 mb-1 rounded-lg border px-3 py-1.5 ${groupIdx > 0 ? 'mt-4' : 'mt-2'} ${bgBorderClass}`}
                  >
                    <div className="grid grid-cols-12 items-center gap-2">
                      {/* Label spanning icon + name columns */}
                      <div className={`col-span-6 sm:col-span-4 text-xs font-bold uppercase tracking-wider ${labelClass}`}>
                        {style ? style.label : 'Other'}
                      </div>
                      {/* Planned total */}
                      <div className={`col-span-2 text-right text-xs font-bold ${labelClass}`}>
                        {formatCurrency(groupPlanned, 'USD', { hideCents: true })}
                      </div>
                      {/* Actual total */}
                      <div className={`col-span-2 text-right text-xs font-bold ${labelClass}`}>
                        {formatCurrency(groupActual, 'USD', { hideCents: true })}
                      </div>
                      {/* Variance total */}
                      <div
                        className={`col-span-2 text-right text-xs font-bold ${
                          groupVariance === 0
                            ? labelClass
                            : groupVariantGood
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {groupVariance === 0
                          ? '—'
                          : `${groupIsOver ? '+' : '-'}${formatCurrency(Math.abs(groupVariance), 'USD', { hideCents: true })}`}
                      </div>
                      {/* % used/received */}
                      <div
                        className={`hidden sm:block sm:col-span-2 text-right text-xs font-bold ${
                          groupPct === null
                            ? labelClass
                            : isIncomeGroup
                              ? groupPct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                              : groupVariantGood
                                ? labelClass
                                : groupIsOver ? 'text-red-600 dark:text-red-400' : labelClass
                        }`}
                      >
                        {groupPct === null ? '—' : `${groupPct}%`}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Category rows */}
              <div className="divide-y divide-stone-100 dark:divide-stone-700">
                {items.map((item) => {
                  const i = rowIndex++;
                  const isIncome = item.categoryType === 'income';
                  const alert = isIncome ? null : categoryAlert(item, thresholds);
                  const variance = item.actual - item.planned;
                  const isOver = variance > 0;
                  // Income: earning more than planned is good; expenses: going over is bad
                  const variantGood = isIncome ? isOver : !isOver;
                  const isExpanded = expandedCategoryId === item.categoryId;
                  const pct = item.planned > 0 ? Math.round((item.actual / item.planned) * 100) : null;

                  // Left border indicates alert status (expenses only)
                  const borderClass =
                    !isIncome && alert?.level === 'danger'
                      ? 'border-l-2 border-l-red-400'
                      : !isIncome && alert?.level === 'warning'
                        ? 'border-l-2 border-l-amber-400'
                        : 'border-l-2 border-l-transparent';

                  return (
                    <div
                      key={item.categoryId}
                      className="animate-fade-in-up"
                      style={{ animationDelay: `${i * 40}ms` }}
                    >
                      <div
                        className={`py-3 transition-colors ${borderClass} ${onCategoryClick ? 'cursor-pointer rounded-r-xl hover:bg-amber-50/40 dark:hover:bg-amber-900/20' : ''} ${isExpanded ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''}`}
                        onClick={() => onCategoryClick?.(item.categoryId)}
                      >
                        <div className="grid grid-cols-12 items-center gap-2 px-1">
                          {/* Expand chevron */}
                          <div className="col-span-1 flex items-center justify-center">
                            {onCategoryClick && (
                              <svg
                                className={`h-4 w-4 text-stone-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                              </svg>
                            )}
                          </div>

                          {/* Category name + color dot */}
                          <div className="col-span-5 sm:col-span-3 flex items-center gap-2.5">
                            <span
                              className="h-3 w-3 shrink-0 rounded-full"
                              style={{ backgroundColor: item.categoryColor }}
                            />
                            <span className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                              {item.categoryName}
                            </span>
                          </div>

                          {/* Planned */}
                          <div className="col-span-2 text-right text-sm text-stone-600 dark:text-stone-400">
                            {formatCurrency(item.planned, 'USD', { hideCents: true })}
                          </div>

                          {/* Actual */}
                          <div className="col-span-2 text-right text-sm font-medium text-stone-900 dark:text-stone-100">
                            {formatCurrency(item.actual, 'USD', { hideCents: true })}
                          </div>

                          {/* Variance — income: positive is good; expenses: positive is bad */}
                          <div
                            className={`col-span-2 text-right text-sm font-medium ${
                              variantGood ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {isOver ? '+' : variance !== 0 ? '-' : ''}
                            {formatCurrency(Math.abs(variance), 'USD', { hideCents: true })}
                          </div>

                          {/* % Used / Received */}
                          <div
                            className={`hidden sm:block sm:col-span-2 text-right text-sm font-semibold ${
                              isIncome
                                ? pct === null
                                  ? 'text-stone-400 dark:text-stone-500'
                                  : pct >= 100
                                    ? 'text-emerald-600'
                                    : 'text-red-600'
                                : alert?.level === 'danger'
                                  ? 'text-red-600'
                                  : alert?.level === 'warning'
                                    ? 'text-amber-600'
                                    : alert?.level === 'underBudget'
                                      ? 'text-emerald-600'
                                      : 'text-stone-700 dark:text-stone-300'
                            }`}
                          >
                            {pct === null
                              ? '—'
                              : isIncome
                                ? `${pct}%`
                                : alert?.pct === Infinity
                                  ? '—'
                                  : `${alert?.pct}%`}
                          </div>
                        </div>
                      </div>

                      {/* Inline drill-down below this row */}
                      {isExpanded && renderDrillDown && renderDrillDown(item.categoryId)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
