import { formatCurrency } from '../../utils/helpers';

/**
 * Three stat cards: Income, Expenses, Net.
 * Displays monthly or YTD data depending on viewMode.
 * All values in cents.
 * @param {{ income: number, expenses: number, viewMode?: 'monthly' | 'ytd' }} props
 */
export default function MonthlyStats({ income, expenses, viewMode = 'monthly' }) {
  const net = income - expenses;
  const period = viewMode === 'ytd' ? 'year to date' : 'this month';
  const netLabel = net === 0 ? 'Balanced' : net > 0 ? 'Surplus' : 'Deficit';

  const cards = [
    {
      label: 'Net',
      value: net,
      color: net >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400',
      border: net >= 0 ? 'border-emerald-200/60' : 'border-red-200/60',
      iconBg: net >= 0 ? 'bg-emerald-100' : 'bg-red-100',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Income',
      value: income,
      color: 'text-emerald-700 dark:text-emerald-400',
      border: 'border-emerald-200/60',
      iconBg: 'bg-emerald-100',
      icon: (
        <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0l-6.75 6.75M12 4.5l6.75 6.75" />
        </svg>
      ),
    },
    {
      label: 'Expenses',
      value: expenses,
      color: 'text-red-700 dark:text-red-400',
      border: 'border-red-200/60',
      iconBg: 'bg-red-100',
      icon: (
        <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l6.75-6.75M12 19.5l-6.75-6.75" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Monthly stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6">
        {cards.map((card, i) => (
          <div
            key={card.label}
            className={`min-w-0 animate-fade-in-up rounded-2xl border ${card.border} bg-white p-3.5 shadow-md shadow-stone-200/30 sm:p-6 dark:bg-stone-800 dark:shadow-stone-900/50 ${card.label === 'Net' ? 'col-span-2 sm:col-span-1' : ''}`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="mb-2 flex items-center gap-2 sm:mb-3 sm:gap-3">
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg sm:h-10 sm:w-10 ${card.iconBg}`}>
                {card.icon}
              </div>
              <p className="text-sm font-medium text-stone-500 dark:text-stone-400">{card.label}</p>
            </div>
            <p className={`break-words font-bold tabular-nums sm:text-3xl ${card.label === 'Net' ? 'text-3xl' : 'text-lg'} ${card.color}`}>
              {card.label === 'Net' && net > 0 ? '+' : ''}
              {formatCurrency(card.value)}
            </p>
            {card.label === 'Net' && (
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                {netLabel} {period}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
