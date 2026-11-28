import { formatCurrency } from '../../utils/helpers';

const money = (cents) => formatCurrency(cents, 'USD', { hideCents: true });

/** Signed change text with percent, e.g. "+$120 (+18%)". */
function changeText(change, compare) {
  const sign = change > 0 ? '+' : '−';
  const pct = compare > 0 ? ` (${sign}${Math.round((Math.abs(change) / compare) * 100)}%)` : '';
  return `${sign}${money(Math.abs(change))}${pct}`;
}

/**
 * Change between an actual and a comparison value. More income or less
 * spending reads as good (emerald); the opposite uses the warn color.
 *
 * @param {{ actual: number, compare: number, isIncome?: boolean, emptyLabel?: string }} props
 * `emptyLabel`, when given, replaces the chip if there is no comparison value.
 */
export default function ChangeChip({ actual, compare, isIncome = false, emptyLabel }) {
  if (emptyLabel && compare === 0) {
    return <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{emptyLabel}</span>;
  }
  const change = actual - compare;
  if (change === 0) return <span className="text-xs font-medium text-stone-500 dark:text-stone-400">No change</span>;
  const good = isIncome ? change > 0 : change < 0;
  return (
    <span className={`text-xs font-semibold tabular-nums ${good ? 'text-emerald-700 dark:text-emerald-400' : 'text-warn'}`}>
      {changeText(change, compare)}
    </span>
  );
}
