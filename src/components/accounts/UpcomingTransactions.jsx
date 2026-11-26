import { useMemo } from 'react';
import { formatCurrency, maskAccountName } from '../../utils/helpers';
import { CATEGORY_FALLBACK_COLOR } from '../../constants/chartColors';

const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const m = SHORT_MONTHS[d.getMonth() + 1];
  const day = d.getDate();
  return `Week of ${m} ${day}`;
}

function formatShortDate(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${SHORT_MONTHS[Number(m)]} ${Number(d)}`;
}

/**
 * UpcomingTransactions — grouped list of pending/projected transactions.
 *
 * Props:
 *  - transactions: Array<{ id, transaction_date, description, payee, amount, is_income, status, categories, accounts }>
 *    Forecast-only rows set `_synthetic: 'hypothetical' | 'settlement'` and are
 *    not clickable. Placeholder payments the forecast replaces carry
 *    `_replacedWith` (cents) — the calculated amount.
 *  - onViewTransaction: (accountId: string) => void
 */
export default function UpcomingTransactions({ transactions = [], onViewTransaction }) {
  // Group by week
  const groups = useMemo(() => {
    if (!transactions.length) return [];
    const map = {};
    for (const tx of transactions) {
      // Get Monday of the week
      const d = new Date(tx.transaction_date + 'T00:00:00');
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = { weekStart: key, label: weekLabel(key), items: [] };
      map[key].items.push(tx);
    }
    return Object.values(map).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }, [transactions]);

  if (!transactions.length) {
    return (
      <div className="mt-6">
        <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-3">
          Upcoming Transactions
        </p>
        <p className="py-6 text-center text-sm text-stone-400 dark:text-stone-500">
          No upcoming transactions found for selected accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-3">
        Upcoming Transactions
      </p>

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.weekStart}>
            <p className="mb-1.5 text-xs font-semibold text-stone-500 dark:text-stone-400">
              {group.label}
            </p>
            <div className="divide-y divide-stone-100 rounded-xl border border-stone-200/60 bg-white/60 shadow-sm dark:divide-stone-700/60 dark:border-stone-700/60 dark:bg-stone-800/60">
              {group.items.map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  disabled={Boolean(tx._synthetic)}
                  onClick={() => onViewTransaction?.(tx.account_id || tx.accounts?.id)}
                  className="flex w-full disabled:cursor-default items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-700/40 first:rounded-t-xl last:rounded-b-xl"
                >
                  {/* Category color dot */}
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tx.categories?.color || CATEGORY_FALLBACK_COLOR }}
                  />

                  {/* Date + description */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                      {tx.payee || tx.description || 'Unnamed'}
                    </p>
                    <p className="text-[11px] text-stone-400 dark:text-stone-500">
                      {formatShortDate(tx.transaction_date)}
                      {tx.accounts?.name && (
                        <span className="ml-1.5">· {maskAccountName(tx.accounts.name)}</span>
                      )}
                      {tx.categories?.name && (
                        <span className="ml-1.5">· {tx.categories.name}</span>
                      )}
                    </p>
                  </div>

                  {/* Amount */}
                  <div className="shrink-0 text-right">
                    {tx._replacedWith != null ? (
                      <p className="text-sm font-bold text-stone-700 dark:text-stone-200">
                        <span className="mr-1.5 text-xs font-medium text-stone-400 line-through">
                          {formatCurrency(Math.abs(tx.amount))}
                        </span>
                        {tx.is_income ? '+' : '−'}{formatCurrency(tx._replacedWith)}
                      </p>
                    ) : (
                      <p className={`text-sm font-bold ${tx.is_income ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {tx.is_income ? '+' : '−'}{formatCurrency(Math.abs(tx.amount))}
                      </p>
                    )}
                    <p className={`text-[10px] ${
                      tx._synthetic === 'hypothetical' ? 'font-semibold text-teal-600 dark:text-teal-400'
                        : tx._synthetic === 'settlement' || tx._replacedWith != null ? 'font-semibold text-violet-600 dark:text-violet-400'
                          : 'text-stone-400 dark:text-stone-500'
                    }`}>
                      {tx._synthetic === 'hypothetical' ? 'test item'
                        : tx._synthetic === 'settlement' ? 'statement payment (forecast)'
                          : tx._replacedWith != null ? 'placeholder → statement balance'
                            : tx.status === 'projected' ? 'projected' : 'pending'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
