import { formatCurrency } from '../../utils/helpers';

/**
 * Three stat cards: Income, Expenses, Net.
 * Displays monthly or YTD data depending on viewMode.
 * All values in cents.
 * @param {{ income: number, expenses: number, viewMode?: 'monthly' | 'ytd' }} props
 */
export default function MonthlyStats({ income, expenses, viewMode = 'monthly' }) {
  const net = income - expenses;
  const isYTD = viewMode === 'ytd';

  const cards = [
    {
      label: 'Income',
      value: income,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
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
      color: 'text-red-600',
      bg: 'bg-red-50',
      border: 'border-red-200/60',
      iconBg: 'bg-red-100',
      icon: (
        <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l6.75-6.75M12 19.5l-6.75-6.75" />
        </svg>
      ),
    },
    {
      label: 'Net',
      value: net,
      color: net >= 0 ? 'text-emerald-600' : 'text-red-600',
      bg: net >= 0 ? 'bg-emerald-50' : 'bg-red-50',
      border: net >= 0 ? 'border-emerald-200/60' : 'border-red-200/60',
      iconBg: net >= 0 ? 'bg-emerald-100' : 'bg-red-100',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Monthly stat cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {cards.map((card, i) => (
          <div
            key={card.label}
            className={`animate-fade-in-up rounded-2xl border ${card.border} bg-white p-6 shadow-md shadow-stone-200/30 dark:bg-stone-800 dark:shadow-stone-900/50`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="mb-3 flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.iconBg}`}>
                {card.icon}
              </div>
              <p className="text-sm font-medium text-stone-500 dark:text-stone-400">{card.label}</p>
            </div>
            <p className={`text-3xl font-bold ${card.color}`}>
              {card.label === 'Net' && net > 0 ? '+' : ''}
              {formatCurrency(Math.abs(card.value))}
            </p>
            {card.label === 'Net' && (
              <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
                {net >= 0
                  ? (isYTD ? 'Surplus year to date' : 'Surplus this month')
                  : (isYTD ? 'Deficit year to date' : 'Deficit this month')}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
