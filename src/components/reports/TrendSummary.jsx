import { formatCurrency } from '../../utils/helpers';
import StatCards from './StatCards';

/**
 * Summary statistics for spending trends: average, highest month, lowest month.
 *
 * @param {{
 *   average: number,
 *   highest: { label: string, spent: number } | null,
 *   lowest:  { label: string, spent: number } | null,
 *   total: number,
 *   monthCount: number,
 * }} props  – output of `computeTrendSummary()` (all values in cents)
 */
export default function TrendSummary({ average, highest, lowest, monthCount }) {
  if (!monthCount) {
    return (
      <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <h3 className="mb-3 text-lg font-semibold text-stone-900 dark:text-stone-100">Trend Summary</h3>
        <p className="py-8 text-center text-sm text-stone-400 dark:text-stone-500">
          Not enough data to display a summary.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <StatCards
        cards={[
          {
            label: 'Average spending / month',
            value: formatCurrency(average),
            sub: `Over ${monthCount} month${monthCount > 1 ? 's' : ''}`,
          },
          { label: 'Highest month', value: highest ? formatCurrency(highest.spent) : '—', sub: highest?.label || '' },
          { label: 'Lowest month', value: lowest ? formatCurrency(lowest.spent) : '—', sub: lowest?.label || '' },
        ]}
      />
    </div>
  );
}
