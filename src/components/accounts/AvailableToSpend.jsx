import { useMemo } from 'react';
import { formatCurrency, maskAccountName } from '../../utils/helpers';

/**
 * AvailableToSpend — per-account stat cards showing current balance,
 * pending, upcoming, and available-to-spend amounts plus a cash runway estimate.
 *
 * Props:
 *  - accounts: Array<{ id, name, type, balance, pending_net, projected_balance, is_asset }>
 *  - selectedAccountIds: string[]
 *  - upcomingTransactions: Array<{ account_id, amount, is_income }>
 */
export default function AvailableToSpend({ accounts = [], selectedAccountIds = [], upcomingTransactions = [] }) {
  const selected = useMemo(
    () => accounts.filter((a) => selectedAccountIds.includes(a.id)),
    [accounts, selectedAccountIds],
  );

  // Upcoming sums per account
  const upcomingSums = useMemo(() => {
    const sums = {};
    for (const tx of upcomingTransactions) {
      if (!sums[tx.account_id]) sums[tx.account_id] = { income: 0, expense: 0 };
      const amt = Math.abs(tx.amount);
      if (tx.is_income) sums[tx.account_id].income += amt;
      else sums[tx.account_id].expense += amt;
    }
    return sums;
  }, [upcomingTransactions]);

  // Per-account cards data
  const cards = useMemo(() => {
    return selected.map((acct) => {
      const upcoming = upcomingSums[acct.id] || { income: 0, expense: 0 };
      const available = acct.balance + (acct.pending_net || 0) + (acct.is_asset
        ? upcoming.income - upcoming.expense
        : upcoming.expense - upcoming.income);
      return {
        id: acct.id,
        name: acct.name,
        type: acct.type,
        balance: acct.balance,
        pendingNet: acct.pending_net || 0,
        upcomingIncome: upcoming.income,
        upcomingExpense: upcoming.expense,
        available,
        isAsset: acct.is_asset,
      };
    });
  }, [selected, upcomingSums]);

  // Totals — negate liability values so totals reflect net (assets − liabilities)
  const totals = useMemo(() => {
    return cards.reduce(
      (acc, c) => {
        const sign = c.isAsset ? 1 : -1;
        return {
          balance: acc.balance + c.balance * sign,
          pending: acc.pending + c.pendingNet * sign,
          upcomingIncome: acc.upcomingIncome + c.upcomingIncome,
          upcomingExpense: acc.upcomingExpense + c.upcomingExpense,
          available: acc.available + c.available * sign,
        };
      },
      { balance: 0, pending: 0, upcomingIncome: 0, upcomingExpense: 0, available: 0 },
    );
  }, [cards]);

  // Cash runway: days until total available hits 0 based on avg daily spend from upcoming
  const runway = useMemo(() => {
    if (totals.available <= 0) return 0;
    const totalUpcomingExpense = totals.upcomingExpense;
    if (totalUpcomingExpense === 0) return null; // no upcoming expenses — infinite
    // Estimate days from upcoming transactions
    const futureDates = upcomingTransactions
      .filter((tx) => !tx.is_income)
      .map((tx) => tx.transaction_date)
      .sort();
    if (!futureDates.length) return null;
    const now = new Date();
    const lastDate = new Date(futureDates[futureDates.length - 1] + 'T00:00:00');
    const daySpan = Math.max(1, Math.round((lastDate - now) / (1000 * 60 * 60 * 24)));
    const dailySpend = totalUpcomingExpense / daySpan;
    if (dailySpend === 0) return null;
    return Math.round(totals.available / dailySpend);
  }, [totals, upcomingTransactions]);

  if (!selected.length) return null;

  function colorForAmount(cents) {
    if (cents > 0) return 'text-emerald-600 dark:text-emerald-400';
    if (cents < 0) return 'text-red-600 dark:text-red-400';
    return 'text-stone-600 dark:text-stone-400';
  }

  return (
    <div className="mt-6">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
        Available to Spend
      </p>

      {/* Total summary bar */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-stone-200/60 bg-white/60 px-5 py-3 shadow-sm dark:border-stone-700/60 dark:bg-stone-800/60">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Current</p>
          <p className={`text-lg font-bold ${colorForAmount(totals.balance)}`}>
            {formatCurrency(Math.abs(totals.balance))}
          </p>
        </div>
        <span className="text-stone-300 dark:text-stone-600">+</span>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Pending</p>
          <p className={`text-lg font-bold ${colorForAmount(totals.pending)}`}>
            {totals.pending >= 0 ? '+' : '−'}{formatCurrency(Math.abs(totals.pending))}
          </p>
        </div>
        <span className="text-stone-300 dark:text-stone-600">+</span>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Upcoming</p>
          <p className="text-lg font-bold text-stone-600 dark:text-stone-300">
            +{formatCurrency(totals.upcomingIncome)} / −{formatCurrency(totals.upcomingExpense)}
          </p>
        </div>
        <span className="text-stone-300 dark:text-stone-600">=</span>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-teal-500 dark:text-teal-400">Available</p>
          <p className={`text-xl font-extrabold ${colorForAmount(totals.available)}`}>
            {totals.available < 0 ? '−' : ''}{formatCurrency(Math.abs(totals.available))}
          </p>
        </div>
        {runway !== null && (
          <div className="ml-auto">
            <p className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Cash Runway</p>
            <p className={`text-lg font-bold ${runway < 30 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              ~{runway} days
            </p>
          </div>
        )}
      </div>

      {/* Per-account cards */}
      {cards.length > 1 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-stone-200/60 bg-white/60 px-4 py-3 shadow-sm dark:border-stone-700/60 dark:bg-stone-800/60"
            >
              <p className="mb-2 truncate text-sm font-semibold text-stone-700 dark:text-stone-200">
                {maskAccountName(c.name)}
              </p>
              <div className="grid grid-cols-2 gap-y-1 text-[11px]">
                <span className="text-stone-400">Balance</span>
                <span className={`text-right font-semibold ${colorForAmount(c.isAsset ? c.balance : -c.balance)}`}>
                  {!c.isAsset && c.balance > 0 ? '−' : ''}{formatCurrency(Math.abs(c.balance))}
                </span>
                <span className="text-stone-400">Pending</span>
                <span className={`text-right font-semibold ${colorForAmount(c.isAsset ? c.pendingNet : -c.pendingNet)}`}>
                  {(c.isAsset ? c.pendingNet : -c.pendingNet) >= 0 ? '+' : '−'}{formatCurrency(Math.abs(c.pendingNet))}
                </span>
                <span className="text-stone-400">Upcoming In</span>
                <span className="text-right font-semibold text-emerald-600 dark:text-emerald-400">
                  +{formatCurrency(c.upcomingIncome)}
                </span>
                <span className="text-stone-400">Upcoming Out</span>
                <span className="text-right font-semibold text-red-600 dark:text-red-400">
                  −{formatCurrency(c.upcomingExpense)}
                </span>
              </div>
              <div className="mt-2 border-t border-stone-100 pt-2 dark:border-stone-700">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-teal-500 dark:text-teal-400">{c.isAsset ? 'Available' : 'Owed'}</span>
                  <span className={`text-base font-extrabold ${colorForAmount(c.isAsset ? c.available : -c.available)}`}>
                    {(() => { const disp = c.isAsset ? c.available : -c.available; return `${disp < 0 ? '−' : ''}${formatCurrency(Math.abs(c.available))}`; })()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
