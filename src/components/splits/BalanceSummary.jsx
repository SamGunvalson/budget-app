import { formatCurrency } from '../../utils/helpers';

export default function BalanceSummary({ balance, partnerEmail, onSettleUp, loading, expenseCount }) {
  const absBalance = Math.abs(balance);
  const amountLabel = formatCurrency(absBalance);
  const isSettled = balance === 0;
  const partnerOwes = balance > 0;

  return (
    <section
      aria-label="Balance"
      className="rounded-2xl bg-forest p-6 text-[#fbfcf2] shadow-lg shadow-stone-900/10 sm:p-7"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d8e9d8]">
            {isSettled ? 'Balance' : partnerOwes ? 'Your partner owes you' : 'You owe your partner'}
          </p>
          {loading ? (
            <div className="mt-2 h-12 w-48 animate-pulse rounded-lg bg-white/10" />
          ) : isSettled ? (
            <p className="mt-1.5 font-display text-4xl font-normal leading-tight tracking-tight sm:text-5xl">All settled up</p>
          ) : (
            <p className={`mt-1.5 font-display text-5xl font-normal leading-none tracking-tight sm:text-6xl ${partnerOwes ? '' : 'text-[#f5b887]'}`}>
              {amountLabel}
            </p>
          )}
          {!loading && (
            <p className="mt-2 truncate text-sm text-[#daeadc]">
              {partnerEmail}
              {expenseCount != null && <> · {expenseCount} {expenseCount === 1 ? 'expense' : 'expenses'}</>}
            </p>
          )}
        </div>
        {!isSettled && !loading && (
          <button
            type="button"
            onClick={onSettleUp}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#fbfcf2] px-5 py-2.5 text-sm font-semibold text-forest shadow-sm transition-all hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e7c985] focus-visible:ring-offset-2 focus-visible:ring-offset-forest active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
            Settle Up
          </button>
        )}
      </div>
    </section>
  );
}
