import { formatCurrency } from '../../utils/helpers';
import { categoryAlert } from '../../utils/budgetCalculations';

/**
 * Per-category rows showing planned, actual, variance and % used.
 * Supports click-to-expand drill-down via onCategoryClick / expandedCategoryId.
 * Income categories (categoryType === 'income') use inverted variance semantics.
 *
 * @param {{
 *   data: Array<{
 *     categoryId: string,
 *     categoryName: string,
 *     categoryColor: string,
 *     categoryType?: string,
 *     planned: number,
 *     actual: number,
 *   }>,
 *   onCategoryClick?: (categoryId: string) => void,
 *   expandedCategoryId?: string | null,
 *   renderDrillDown?: (categoryId: string) => React.ReactNode,
 * }} props
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

  return (
    <div className="animate-fade-in rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <h3 className="mb-5 text-lg font-semibold text-stone-900 dark:text-stone-100">
        Category Breakdown
      </h3>

      {/* Header */}
      <div className="mb-3 grid grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">
        <div className="col-span-1"></div>
        <div className="col-span-3">Category</div>
        <div className="col-span-2 text-right">Planned</div>
        <div className="col-span-2 text-right">Actual</div>
        <div className="col-span-2 text-right">Variance</div>
        <div className="col-span-2 text-right">Used</div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-stone-100 dark:divide-stone-700">
        {data.map((item, i) => {
          const isIncome = item.categoryType === 'income';
          const alert = isIncome ? null : categoryAlert(item, thresholds);
          const variance = item.actual - item.planned;
          // For income: positive variance (earned more) is good. For expenses: it's bad.
          const isOver = variance > 0;
          const variantGood = isIncome ? isOver : !isOver;
          const isExpanded = expandedCategoryId === item.categoryId;

          // Progress bar width (capped at 100% visually)
          const barWidth = Math.min(
            item.planned > 0 ? (item.actual / item.planned) * 100 : 0,
            100,
          );
          const pct = item.planned > 0 ? Math.round((item.actual / item.planned) * 100) : null;

          return (
            <div
              key={item.categoryId}
              className="animate-fade-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div
                className={`py-3 transition-colors ${onCategoryClick ? 'cursor-pointer rounded-xl hover:bg-amber-50/40 dark:hover:bg-amber-900/20' : ''} ${isExpanded ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''}`}
                onClick={() => onCategoryClick?.(item.categoryId)}
              >
                <div className="grid grid-cols-12 items-center gap-2 px-1">
                  {/* Alert icon / expand indicator */}
                  <div className="col-span-1 flex items-center justify-center">
                    {onCategoryClick ? (
                      <svg
                        className={`h-4 w-4 text-stone-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    ) : !isIncome && alert && item.planned > 0 ? (
                      <span
                        className="text-base"
                        title={alert.varianceText}
                        role="img"
                        aria-label={alert.level === 'danger' ? 'Over budget' : alert.level === 'warning' ? 'Approaching budget limit' : 'Within budget'}
                      >
                        {alert.icon}
                      </span>
                    ) : null}
                  </div>

                  {/* Category name + color dot */}
                  <div className="col-span-3 flex items-center gap-2.5">
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
                    {formatCurrency(item.planned)}
                  </div>

                  {/* Actual */}
                  <div className="col-span-2 text-right text-sm font-medium text-stone-900 dark:text-stone-100">
                    {formatCurrency(item.actual)}
                  </div>

                  {/* Variance — income: positive is good; expenses: positive is bad */}
                  <div
                    className={`col-span-2 text-right text-sm font-medium ${
                      variantGood ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {isOver ? '+' : ''}
                    {formatCurrency(Math.abs(variance))}
                    {!isOver && variance !== 0 ? ' ↓' : ''}
                    {isOver ? ' ↑' : ''}
                  </div>

                  {/* Percent used / received */}
                  <div
                    className={`col-span-2 text-right text-sm font-semibold ${
                      isIncome
                        ? pct === null
                          ? 'text-stone-400'
                          : pct >= 100
                            ? 'text-emerald-600'
                            : 'text-red-600'
                        : alert?.level === 'danger'
                          ? 'text-red-600'
                          : alert?.level === 'warning'
                            ? 'text-amber-600'
                            : alert?.level === 'underBudget'
                              ? 'text-emerald-600'
                              : 'text-stone-700'
                    }`}
                  >
                    {isIncome
                      ? pct === null ? '—' : `${pct}%`
                      : alert?.pct === Infinity ? '—' : `${alert?.pct}%`}
                    {!isIncome && alert?.level === 'danger' && alert?.pct !== Infinity && (
                      <span className="ml-1 text-xs">⚠</span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {item.planned > 0 && (
                  <div className="mt-2 px-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-700">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isIncome
                            ? (pct ?? 0) >= 100 ? 'bg-emerald-400' : 'bg-red-400'
                            : alert?.level === 'danger'
                              ? 'bg-red-400'
                              : alert?.level === 'warning'
                                ? 'bg-amber-400'
                                : alert?.level === 'underBudget'
                                  ? 'bg-emerald-400'
                                  : 'bg-stone-300 dark:bg-stone-500'
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Inline drill-down below this row */}
              {isExpanded && renderDrillDown && renderDrillDown(item.categoryId)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
