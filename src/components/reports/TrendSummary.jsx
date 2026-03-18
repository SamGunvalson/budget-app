import { formatCurrency } from '../../utils/helpers';

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

  const cards = [
    {
      label: 'Avg / Month',
      primary: formatCurrency(average),
      sub: `Over ${monthCount} month${monthCount > 1 ? 's' : ''}`,
      iconBg: 'bg-violet-100',
      color: 'text-violet-600',
      icon: (
        <svg className="h-5 w-5 text-violet-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      ),
    },
    {
      label: 'Highest Month',
      primary: highest ? formatCurrency(highest.spent) : '—',
      sub: highest?.label || '',
      iconBg: 'bg-red-100',
      color: 'text-red-600',
      icon: (
        <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
        </svg>
      ),
    },
    {
      label: 'Lowest Month',
      primary: lowest ? formatCurrency(lowest.spent) : '—',
      sub: lowest?.label || '',
      iconBg: 'bg-emerald-100',
      color: 'text-emerald-600',
      icon: (
        <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" />
        </svg>
      ),
    },
  ];

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {cards.map((card, i) => (
          <div
            key={card.label}
            className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="mb-3 flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.iconBg}`}>
                {card.icon}
              </div>
              <p className="text-sm font-medium text-stone-500 dark:text-stone-400">{card.label}</p>
            </div>
            <p className={`text-2xl font-bold ${card.color}`}>{card.primary}</p>
            {card.sub && <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{card.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
