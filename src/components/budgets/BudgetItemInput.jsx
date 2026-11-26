import { useState } from 'react';
import { formatCurrency, toDollars } from '../../utils/helpers';
import { alertLevel, percentUsed } from '../../utils/budgetCalculations';
import CategoryWell from '../common/CategoryWell';
import AmountInput from '../common/AmountInput';
import { centsToInput } from '../../utils/calculator';

/**
 * Single row for a category budget allocation: category badge, name, this
 * month's progress (spent or received vs planned), and a dollar input.
 *
 * @param {{
 *   category: { id: string, name: string, color: string, type: string },
 *   plannedAmount: number,          // cents
 *   actual?: number | null,         // cents spent (or received, for income); null hides progress
 *   thresholds?: { warning: number, danger: number },
 *   onChange: (cents: number) => void,
 *   disabled?: boolean,
 * }} props
 */
export default function BudgetItemInput({ category, plannedAmount, actual = null, thresholds, onChange, disabled }) {
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

  const money = (cents) => formatCurrency(cents, 'USD', { hideCents: true });
  const isIncome = category.type === 'income';
  const showProgress = actual != null && (plannedAmount > 0 || actual > 0);
  const pct = percentUsed(Math.max(actual ?? 0, 0), plannedAmount);
  const level = isIncome ? 'success' : alertLevel(pct, thresholds);
  const left = plannedAmount - (actual ?? 0);
  const barColor = isIncome
    ? 'bg-emerald-500 dark:bg-emerald-400'
    : level === 'danger' ? 'bg-red-500 dark:bg-red-400'
    : level === 'warning' ? 'bg-orange-500 dark:bg-orange-400'
    : 'bg-emerald-600/80 dark:bg-emerald-400/80';

  let chip = null;
  if (showProgress) {
    if (plannedAmount === 0) {
      chip = <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600 dark:bg-stone-700 dark:text-stone-300">Unbudgeted</span>;
    } else if (isIncome) {
      chip = left > 0
        ? <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{money(left)} to go</span>
        : <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{left < 0 ? `+${money(-left)} extra` : 'Received'}</span>;
    } else if (left >= 0) {
      chip = <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{money(left)} left</span>;
    } else {
      chip = (
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
          level === 'danger'
            ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
            : 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300'
        }`}>
          {money(-left)} over
        </span>
      );
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <CategoryWell category={category} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
            {category.name}{category.is_archived ? ' (Archived)' : ''}
          </p>
          {showProgress && (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {money(Math.max(actual, 0))} {isIncome ? 'received' : 'spent'}
              {plannedAmount > 0 && <> of {money(plannedAmount)}</>}
            </p>
          )}
        </div>

        {/* Dollar input */}
        <div className="relative w-28 flex-shrink-0 sm:w-32">
        <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center text-sm text-stone-400 dark:text-stone-500">
          $
        </span>
        <AmountInput
          type="text"
          inputMode="decimal"
          value={displayValue}
          calculatorValue={editValue ?? (plannedAmount ? centsToInput(plannedAmount) : '')}
          calculatorLabel={`${category.name} monthly budget`}
          minCents={0}
          onAmountChange={(value, cents) => {
            setEditValue(value);
            onChange(cents);
          }}
          onChange={handleChange}
          onFocus={handleFocus}
          onFieldBlur={handleBlur}
          disabled={disabled}
          placeholder="0"
          className="w-full rounded-lg border border-stone-300 bg-stone-50/50 py-2 pl-7 pr-3 text-right text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
        />
        </div>
      </div>

      {showProgress && (
        <div className="mt-2.5 flex items-center gap-3 pl-12">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
            role="progressbar"
            aria-label={`${category.name}: ${Math.round(Math.min(pct, 999))}% of plan`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(pct, 100))}
          >
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct === Infinity ? 100 : pct, 100)}%` }} />
          </div>
          <span className="shrink-0">{chip}</span>
        </div>
      )}
    </div>
  );
}
