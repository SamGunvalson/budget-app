import { useMemo } from 'react';
import { formatCurrency, maskAccountName } from '../../utils/helpers';
import { isLiabilityAccount } from '../../services/accounts';

const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROLE_LABELS = { cash: 'Cash', reserve: 'Reserve', card: 'Card', ignore: 'Not counted' };

function formatShortDate(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${SHORT_MONTHS[Number(m)]} ${Number(d)}`;
}

function signed(cents) {
  return `${cents < 0 ? '−' : ''}${formatCurrency(Math.abs(cents))}`;
}

/**
 * AvailableToSpend — per-account outlook for the accounts on the chart:
 * balance today, the lowest point ahead, and the balance at the end of the
 * range, all with test items applied and card statements settled.
 * Liabilities are shown as the amount owed.
 *
 * Props:
 *  - accounts, chartAccountIds
 *  - result: buildCashflowScenario() output, or null
 *  - todayStr: YYYY-MM-DD
 */
export default function AvailableToSpend({ accounts = [], chartAccountIds = [], result = null, todayStr }) {
  const cards = useMemo(() => {
    if (!result) return [];
    const { dates, scenario, roles } = result;
    const todayIdx = Math.max(0, dates.findIndex((d) => d >= todayStr));
    const last = dates.length - 1;
    return accounts
      .filter((a) => chartAccountIds.includes(a.id) && scenario.balances[a.id])
      .map((a) => {
        const values = scenario.balances[a.id];
        const liability = isLiabilityAccount(a.type);
        // For liabilities the "worst" point is the most owed.
        let worstIdx = todayIdx;
        for (let i = todayIdx; i <= last; i += 1) {
          if (liability ? values[i] > values[worstIdx] : values[i] < values[worstIdx]) worstIdx = i;
        }
        return {
          id: a.id,
          name: a.name,
          liability,
          role: roles[a.id],
          today: values[todayIdx],
          worst: values[worstIdx],
          worstDate: dates[worstIdx],
          end: values[last],
          endDate: dates[last],
        };
      });
  }, [accounts, chartAccountIds, result, todayStr]);

  if (!cards.length) return null;

  const amountClass = (c, cents) => {
    // Owing on a card is normal; only a negative asset balance is a warning.
    const bad = !c.liability && cents < 0;
    return bad ? 'text-red-600 dark:text-red-400' : 'text-stone-800 dark:text-stone-200';
  };

  return (
    <div className="mt-6">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
        Account Outlook
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.id}
            className="rounded-xl border border-stone-200/60 bg-white/60 px-4 py-3 shadow-sm dark:border-stone-700/60 dark:bg-stone-800/60"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-stone-700 dark:text-stone-200">{maskAccountName(c.name)}</p>
              <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">
                {ROLE_LABELS[c.role] || ''}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-y-1 text-[11px]">
              <span className="text-stone-400">{c.liability ? 'Owed today' : 'Today'}</span>
              <span className={`text-right font-semibold ${amountClass(c, c.today)}`}>{signed(c.today)}</span>
              <span className="text-stone-400">{c.liability ? 'Most owed' : 'Lowest'} ({formatShortDate(c.worstDate)})</span>
              <span className={`text-right font-semibold ${amountClass(c, c.worst)}`}>{signed(c.worst)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-stone-100 pt-2 dark:border-stone-700">
              <span className="text-[10px] uppercase tracking-wider text-teal-500 dark:text-teal-400">
                {c.liability ? 'Owed' : 'Balance'} on {formatShortDate(c.endDate)}
              </span>
              <span className={`text-base font-extrabold ${amountClass(c, c.end)}`}>{signed(c.end)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
