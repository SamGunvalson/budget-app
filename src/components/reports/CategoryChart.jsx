import { useState } from 'react';
import { toDollars, formatCurrency } from '../../utils/helpers';

/**
 * Single category bar row — hoverable, clickable, with inline tooltip.
 */
function CategoryBar({ entry, maxValue, isExpanded, isDimmed, onClick }) {
  const [hovered, setHovered] = useState(false);
  const barPct = maxValue > 0 ? (entry.value / maxValue) * 100 : 0;

  return (
    <div
      className={`group relative flex items-center gap-3 rounded-xl px-2 py-2 transition-all ${
        onClick ? 'cursor-pointer' : ''
      } ${isExpanded ? 'bg-amber-50/50 dark:bg-amber-900/20' : 'hover:bg-stone-50/60 dark:hover:bg-stone-700/40'}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Category name */}
      <div
        className={`w-28 flex-shrink-0 truncate text-[13px] font-medium transition-opacity ${
          isDimmed ? 'text-stone-400' : 'text-stone-800 dark:text-stone-200'
        }`}
        title={entry.name}
      >
        {entry.name}
      </div>

      {/* Bar track */}
      <div className="relative flex-1">
        <div className="h-7 w-full overflow-hidden rounded-r-lg bg-stone-100/60 dark:bg-stone-700/40">
          <div
            className="h-full rounded-r-lg transition-all duration-500"
            style={{
              width: `${Math.max(barPct, 1)}%`,
              backgroundColor: entry.color || '#F59E0B',
              opacity: isDimmed ? 0.35 : 1,
            }}
          />
        </div>

        {/* Hover tooltip */}
        {hovered && (
          <div className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-xl border border-stone-200/60 bg-white px-4 py-2.5 shadow-lg shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
            <p className="text-sm font-medium" style={{ color: entry.color }}>
              {entry.name}
            </p>
            <p className="text-base font-bold text-stone-900 dark:text-stone-100">
              {formatCurrency(entry.valueCents)}
            </p>
            {onClick && (
              <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                Click to view transactions
              </p>
            )}
          </div>
        )}
      </div>

      {/* Value label */}
      <div
        className={`w-24 flex-shrink-0 text-right text-sm font-semibold tabular-nums transition-opacity ${
          isDimmed ? 'text-stone-400' : 'text-stone-700 dark:text-stone-300'
        }`}
      >
        {formatCurrency(entry.valueCents)}
      </div>

      {/* Expand indicator */}
      {onClick && (
        <svg
          className={`h-4 w-4 flex-shrink-0 text-stone-300 transition-transform duration-200 ${
            isExpanded ? 'rotate-90 text-amber-500' : 'group-hover:text-stone-500'
          }`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 4.5l7.5 7.5-7.5 7.5"
          />
        </svg>
      )}
    </div>
  );
}

/**
 * Horizontal bar chart showing a breakdown by category.
 * Each bar is its own HTML row, so the drill-down panel can be inserted
 * directly below the selected bar.
 *
 * @param {{
 *   data: Array<{ name: string, valueCents: number, color: string }>,
 *   title?: string,
 *   emptyMessage?: string,
 *   cursorColor?: string,
 *   onCategoryClick?: (categoryName: string) => void,
 *   expandedCategory?: string | null,
 *   renderDrillDown?: (categoryName: string) => React.ReactNode,
 * }} props
 */
export default function CategoryChart({
  data,
  title = 'Spending by Category',
  emptyMessage = 'No data for this month.',
  onCategoryClick,
  expandedCategory,
  renderDrillDown,
}) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <h3 className="mb-4 text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
        <p className="py-10 text-center text-sm text-stone-400 dark:text-stone-500">
          {emptyMessage}
        </p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    value: toDollars(d.valueCents),
  }));

  const maxValue = Math.max(...chartData.map((d) => d.value), 0);

  return (
    <div className="animate-fade-in rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <h3 className="mb-4 text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h3>

      <div className="space-y-0.5">
        {chartData.map((entry, idx) => {
          const isExpanded = expandedCategory === entry.name;
          const isDimmed =
            expandedCategory != null && expandedCategory !== entry.name;

          return (
            <div key={entry.name || idx}>
              <CategoryBar
                entry={entry}
                maxValue={maxValue}
                isExpanded={isExpanded}
                isDimmed={isDimmed}
                onClick={
                  onCategoryClick
                    ? () => onCategoryClick(entry.name)
                    : undefined
                }
              />
              {/* Drill-down panel directly below this bar */}
              {isExpanded && renderDrillDown && renderDrillDown(entry.name)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
