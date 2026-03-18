import { useState } from 'react';
import { toDollars } from '../../utils/helpers';

/**
 * Single row for a category budget allocation.
 * Renders the category color swatch, name, type badge, and a dollar input.
 *
 * @param {{
 *   category: { id: string, name: string, color: string, type: string },
 *   plannedAmount: number,          // cents
 *   onChange: (cents: number) => void,
 *   disabled?: boolean,
 * }} props
 */
export default function BudgetItemInput({ category, plannedAmount, onChange, disabled }) {
  const [editValue, setEditValue] = useState(null);
  // Exact decimal string shown when focused (e.g. "10.50")
  const exactDollars = plannedAmount ? toDollars(plannedAmount, { raw: true }).toFixed(2) : '';
  // Rounded whole-dollar string shown when not focused (e.g. "10")
  const roundedDollars = plannedAmount ? String(Math.round(toDollars(plannedAmount))) : '';
  const displayValue = editValue !== null ? editValue : roundedDollars;

  const handleFocus = (e) => {
    setEditValue(exactDollars);
    // Defer select until after React re-renders with the new value
    const target = e.target;
    setTimeout(() => target.select(), 0);
  };

  const handleBlur = () => {
    setEditValue(null);
  };

  const handleChange = (e) => {
    const raw = e.target.value;
    setEditValue(raw);
    if (raw === '' || raw === '0') {
      onChange(0);
      return;
    }
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed) || parsed < 0) return;
    // store as cents
    onChange(Math.round(parsed * 100));
  };

  const typeBadge = {
    needs: 'bg-red-50 text-red-700 dark:bg-red-900/50 dark:text-red-300',
    wants: 'bg-pink-50 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300',
    savings: 'bg-teal-50 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
    income: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  }[category.type] || 'bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300';

  return (
    <div className="flex items-center gap-4 rounded-xl border border-stone-200/60 bg-white px-4 py-3 shadow-sm transition-all hover:shadow-md dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      {/* Color swatch */}
      <span
        className="h-3 w-3 flex-shrink-0 rounded-full"
        style={{ backgroundColor: category.color }}
      />

      {/* Name + type */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
          {category.name}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeBadge}`}>
          {category.type}
        </span>
      </div>

      {/* Dollar input */}
      <div className="relative w-32 flex-shrink-0">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-400 dark:text-stone-500">
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder="0"
          className="w-full rounded-lg border border-stone-300 bg-stone-50/50 py-2 pl-7 pr-3 text-right text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
        />
      </div>
    </div>
  );
}
