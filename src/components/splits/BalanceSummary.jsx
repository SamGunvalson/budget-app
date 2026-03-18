export default function BalanceSummary({ balance, partnerEmail, onSettleUp, loading }) {
  const absBalance = Math.abs(balance);
  const dollars = (absBalance / 100).toFixed(2);
  const isSettled = balance === 0;
  const partnerOwes = balance > 0;

  return (
    <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-stone-500 dark:text-stone-400 mb-1">Balance</p>
          {loading ? (
            <div className="h-8 w-48 animate-pulse rounded-lg bg-stone-200 dark:bg-stone-700" />
          ) : isSettled ? (
            <p className="text-2xl font-bold text-stone-600 dark:text-stone-400">
              All settled up! ✓
            </p>
          ) : partnerOwes ? (
            <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">
              <span className="text-stone-500 dark:text-stone-400 text-base font-medium">{partnerEmail} owes you</span>{' '}
              ${dollars}
            </p>
          ) : (
            <p className="text-2xl font-bold text-red-500 dark:text-red-400">
              <span className="text-stone-500 dark:text-stone-400 text-base font-medium">You owe {partnerEmail}</span>{' '}
              ${dollars}
            </p>
          )}
        </div>
        {!isSettled && !loading && (
          <button
            onClick={onSettleUp}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition-all hover:from-amber-600 hover:to-amber-700 hover:shadow-lg hover:shadow-amber-500/30 active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
            Settle Up
          </button>
        )}
      </div>
    </div>
  );
}
