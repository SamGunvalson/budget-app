import { useEffect, useState, useMemo } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
} from 'date-fns';
import { getTransactionsOffline } from '../../services/offlineAware';
import { formatCurrency, isTrueIncome, isSpendingCredit, isIncomeDebit } from '../../utils/helpers';
import Modal from '../common/Modal';

const CHIP_LIMIT = 3;

/**
 * CalendarView — monthly calendar grid showing actual transaction chips per day.
 *
 * Props:
 *  - month: number (1-12)
 *  - year: number
 */
export default function CalendarView({ month, year }) {
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDays, setExpandedDays] = useState(new Set());
  const [selectedDay, setSelectedDay] = useState(null);

  const toggleDayExpand = (key, e) => {
    if (e) e.stopPropagation();
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Fetch transactions for the selected month
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError('');
      setExpandedDays(new Set());
      setSelectedDay(null);
      try {
        const data = await getTransactionsOffline({ month, year, status: 'all' });
        if (!cancelled) setTransactions(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load transactions');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [month, year]);

  // Build date → transactions map
  const transactionsByDay = useMemo(() => {
    const map = new Map();
    for (const t of transactions) {
      // Use the raw date string (YYYY-MM-DD) to avoid timezone issues
      const key = t.transaction_date?.slice(0, 10);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    return map;
  }, [transactions]);

  // Calendar grid computation
  const calendarMonth = new Date(year, month - 1, 1);
  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const gridDays = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Classify a transaction for display
  const classifyTx = (t) => {
    if (t.categories?.type === 'transfer') return 'transfer';
    if (isTrueIncome(t)) return 'income';
    if (isIncomeDebit(t)) return 'incomeDebit';
    if (isSpendingCredit(t)) return 'spendingCredit';
    return 'expense';
  };

  const amountPrefix = (type) => {
    if (type === 'transfer') return '↔ ';
    if (type === 'income') return '+';
    if (type === 'spendingCredit') return '+';
    if (type === 'incomeDebit') return '−';
    return '−';
  };

  const amountColorClass = (type) => {
    if (type === 'income' || type === 'spendingCredit') return 'text-emerald-600 dark:text-emerald-400';
    if (type === 'transfer') return 'text-stone-500 dark:text-stone-400';
    return 'text-red-600 dark:text-red-400';
  };

  // Day detail modal: transactions for selected day
  const selectedDayTransactions = useMemo(() => {
    if (!selectedDay) return [];
    return transactionsByDay.get(selectedDay) || [];
  }, [selectedDay, transactionsByDay]);

  // Compute daily net for modal footer (exclude transfers)
  const selectedDayNet = useMemo(() => {
    let net = 0;
    for (const t of selectedDayTransactions) {
      const type = classifyTx(t);
      if (type === 'transfer') continue;
      if (type === 'income') net += t.amount;
      else if (type === 'spendingCredit') net += t.amount;
      else if (type === 'incomeDebit') net -= t.amount;
      else net -= t.amount;
    }
    return net;
  }, [selectedDayTransactions]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
        <span className="mr-1.5">⚠</span>{error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 dark:border-stone-700 dark:bg-stone-700">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse bg-white dark:bg-stone-800" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-1">
      {/* Day-of-week header */}
      <div className="mb-1 grid grid-cols-7">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="py-1 text-center text-xs font-medium text-stone-400 dark:text-stone-500"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 dark:border-stone-700 dark:bg-stone-700">
        {gridDays.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, calendarMonth);
          const isCurrentDay = isToday(day);
          const items = transactionsByDay.get(key) || [];
          const isExpanded = expandedDays.has(key);
          const visible = isExpanded ? items : items.slice(0, CHIP_LIMIT);
          const overflow = isExpanded ? 0 : items.length - CHIP_LIMIT;

          return (
            <div
              key={key}
              onClick={() => items.length > 0 && setSelectedDay(key)}
              className={`flex min-h-22 cursor-pointer flex-col gap-0.5 p-1.5 transition-colors hover:bg-rose-50/50 dark:hover:bg-rose-950/20 ${
                inMonth
                  ? isCurrentDay
                    ? 'bg-amber-50 dark:bg-amber-950/30'
                    : 'bg-white dark:bg-stone-800'
                  : 'bg-stone-50 dark:bg-stone-900/50'
              }`}
            >
              {/* Day number */}
              <span
                className={`mb-0.5 self-end text-xs font-medium leading-none ${
                  isCurrentDay
                    ? 'flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white'
                    : inMonth
                      ? 'text-stone-700 dark:text-stone-300'
                      : 'text-stone-300 dark:text-stone-600'
                }`}
              >
                {format(day, 'd')}
              </span>

              {/* Transaction chips */}
              {visible.map((t, i) => {
                const type = classifyTx(t);
                const catColor = t.categories?.color || '#A8A29E';
                const label = t.description || t.payee || 'Transaction';
                const statusDashed = t.status === 'projected' || t.status === 'pending';

                return (
                  <button
                    key={`${t.id}-${i}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDay(key);
                    }}
                    title={`${label} · ${amountPrefix(type)}${formatCurrency(Math.abs(t.amount))}`}
                    className={`w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium leading-tight text-white transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-white focus:ring-offset-1 ${
                      statusDashed ? 'opacity-70 border border-dashed border-white/40' : ''
                    }`}
                    style={{ backgroundColor: catColor }}
                  >
                    {label}
                    <span className="ml-0.5 opacity-90">
                      {' '}{amountPrefix(type)}{formatCurrency(Math.abs(t.amount))}
                    </span>
                  </button>
                );
              })}

              {overflow > 0 && (
                <button
                  type="button"
                  onClick={(e) => toggleDayExpand(key, e)}
                  className="pl-1 text-left text-[10px] text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 focus:outline-none"
                >
                  +{overflow} more
                </button>
              )}
              {isExpanded && items.length > CHIP_LIMIT && (
                <button
                  type="button"
                  onClick={(e) => toggleDayExpand(key, e)}
                  className="pl-1 text-left text-[10px] text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 focus:outline-none"
                >
                  show less
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Day Detail Modal */}
      {selectedDay && (
        <Modal
          title={format(new Date(selectedDay + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
          onClose={() => setSelectedDay(null)}
        >
          {selectedDayTransactions.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400">No transactions on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedDayTransactions.map((t) => {
                const type = classifyTx(t);
                const catColor = t.categories?.color || '#A8A29E';
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-800/60"
                  >
                    {/* Category dot */}
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: catColor }}
                    />
                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                        {t.description || t.payee || 'Transaction'}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                        {t.payee && t.description && (
                          <span className="truncate">{t.payee}</span>
                        )}
                        <span>{t.categories?.name || 'Uncategorized'}</span>
                        {t.status && t.status !== 'posted' && (
                          <span className="rounded bg-stone-200 px-1 py-0.5 text-[10px] font-medium uppercase dark:bg-stone-700">
                            {t.status}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Amount */}
                    <span className={`shrink-0 text-sm font-semibold ${amountColorClass(type)}`}>
                      {amountPrefix(type)}{formatCurrency(Math.abs(t.amount))}
                    </span>
                  </div>
                );
              })}

              {/* Daily net */}
              <div className="mt-3 flex items-center justify-between border-t border-stone-200 pt-3 dark:border-stone-700">
                <span className="text-sm font-medium text-stone-600 dark:text-stone-400">Daily Net</span>
                <span className={`text-sm font-bold ${
                  selectedDayNet > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : selectedDayNet < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-stone-600 dark:text-stone-400'
                }`}>
                  {selectedDayNet >= 0 ? '+' : '−'}{formatCurrency(Math.abs(selectedDayNet))}
                </span>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
