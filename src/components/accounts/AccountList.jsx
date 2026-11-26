import { useState } from 'react';
import { formatCurrency, maskAccountName } from '../../utils/helpers';
import { ACCOUNT_TYPES, isAssetAccount } from '../../services/accounts';
import EmptyState from '../common/EmptyState';

/**
 * AccountList — displays accounts grouped by Asset / Liability with balances.
 *
 * Props:
 *  - accounts: Array of account objects with `balance` and `projected_balance` fields
 *  - onViewTransactions(accountId): navigate to filtered transaction view
 */
export default function AccountList({ accounts, onViewTransactions }) {
  const [showClosed, setShowClosed] = useState(false);

  if (!accounts || accounts.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200/60 bg-white shadow-sm dark:border-stone-700/60 dark:bg-stone-800">
        <EmptyState
          icon={(
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
          )}
          title="No accounts yet"
          hint="Add your first account in Manage Accounts to start tracking your net worth."
        />
      </div>
    );
  }

  // Separate open and closed accounts
  const openAccounts = accounts.filter((a) => !a.closed_at);
  const closedAccounts = accounts.filter((a) => a.closed_at);
  const visibleAccounts = showClosed ? accounts : openAccounts;

  // Group accounts
  const assetAccounts = visibleAccounts.filter((a) => isAssetAccount(a.type));
  const liabilityAccounts = visibleAccounts.filter((a) => !isAssetAccount(a.type));

  const actualTotal = (list) => list.reduce((sum, a) => sum + a.balance, 0);
  const projectedTotal = (list) => list.reduce((sum, a) => sum + (a.projected_balance ?? a.balance), 0);

  const hasBoth = assetAccounts.length > 0 && liabilityAccounts.length > 0;

  return (
    <div className="space-y-4">
      <div className={hasBoth ? 'grid gap-6 lg:grid-cols-2' : 'space-y-6'}>
        {/* Asset Accounts */}
        {assetAccounts.length > 0 && (
          <AccountGroup
            title="Assets"
            accounts={assetAccounts}
            total={actualTotal(assetAccounts)}
            projectedTotal={projectedTotal(assetAccounts)}
            totalColor="text-stone-900 dark:text-stone-100"
            onViewTransactions={onViewTransactions}
          />
        )}

        {/* Liability Accounts */}
        {liabilityAccounts.length > 0 && (
          <AccountGroup
            title="Liabilities"
            accounts={liabilityAccounts}
            total={actualTotal(liabilityAccounts)}
            projectedTotal={projectedTotal(liabilityAccounts)}
            totalColor="text-stone-900 dark:text-stone-100"
            onViewTransactions={onViewTransactions}
          />
        )}
      </div>

      {/* Show closed accounts toggle */}
      {closedAccounts.length > 0 && (
        <button
          type="button"
          onClick={() => setShowClosed((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
        >
          <svg className={`h-4 w-4 transition-transform ${showClosed ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          {showClosed ? 'Hide' : 'Show'} closed accounts ({closedAccounts.length})
        </button>
      )}
    </div>
  );
}

function AccountGroup({ title, accounts, total, projectedTotal, totalColor, onViewTransactions }) {
  const [tappedId, setTappedId] = useState(null);

  function handleIconTap(id) {
    setTappedId(id);
    setTimeout(() => setTappedId(null), 2000);
  }

  return (
    <section aria-label={title}>
      {/* Group heading — totals line up with the row columns below */}
      <div className="mb-2 flex items-end justify-between px-1 sm:px-0">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600 sm:pl-1 dark:text-stone-300">{title}</h3>
        <div className="flex flex-col items-end sm:flex-row sm:items-end sm:gap-6 sm:pr-6">
          <div className="text-right sm:w-24">
            <p className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Actual</p>
            <span className={`text-sm font-bold tabular-nums sm:text-base ${totalColor}`}>
              {formatCurrency(Math.abs(total))}
            </span>
          </div>
          <div className="text-right sm:w-24">
            <p className="text-[10px] font-medium uppercase tracking-wider text-violet-500 dark:text-violet-400">Projected</p>
            <span className="text-sm font-bold tabular-nums text-violet-600 sm:text-base dark:text-violet-400">
              {formatCurrency(Math.abs(projectedTotal))}
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200/60 bg-white shadow-sm dark:border-stone-700/60 dark:bg-stone-800">
      {/* Account rows */}
      <div className="divide-y divide-stone-200/60 dark:divide-stone-700/50">
        {accounts.map((account) => {
          const actual = account.balance;
          const projected = account.projected_balance ?? account.balance;
          const diff = projected - actual;
          const isLiability = !isAssetAccount(account.type);
          const positiveDiffColor = isLiability
            ? 'text-red-500 dark:text-red-400'
            : 'text-emerald-500 dark:text-emerald-400';
          const negativeDiffColor = isLiability
            ? 'text-emerald-500 dark:text-emerald-400'
            : 'text-red-400 dark:text-red-500';
          const closed = Boolean(account.closed_at);
          return (
            <div
              key={account.id}
              className={`group flex items-center justify-between px-4 sm:px-6 py-3 sm:py-3.5 transition-colors hover:bg-stone-50/50 dark:hover:bg-stone-700/30 ${closed ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => handleIconTap(account.id)}
                    className="block"
                    aria-label={`Account type: ${ACCOUNT_TYPES[account.type]?.label || account.type}`}
                  >
                    <AccountTypeIcon type={account.type} />
                  </button>
                  {tappedId === account.id && (
                    <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 z-10 whitespace-nowrap rounded-md bg-stone-800 px-2 py-0.5 text-[10px] font-medium text-white shadow-md dark:bg-stone-100 dark:text-stone-900">
                      {ACCOUNT_TYPES[account.type]?.label || account.type}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onViewTransactions?.(account.id)}
                    className="block text-left text-sm font-semibold text-stone-900 underline-offset-4 transition-colors line-clamp-2 hover:underline dark:text-stone-100"
                    title="View transactions for this account"
                  >
                    {maskAccountName(account.name)}
                  </button>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                      {ACCOUNT_TYPES[account.type]?.label || account.type}
                    </span>
                    {closed && (
                      <span className="inline-block rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:bg-stone-600 dark:text-stone-300">
                        Closed {account.closed_at}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end sm:flex-row sm:items-center sm:gap-6">
                {/* Actual balance */}
                <span className={`text-right sm:w-24 text-sm font-semibold tabular-nums ${
                  actual >= 0 ? 'text-stone-900 dark:text-stone-100' : 'text-red-600 dark:text-red-400'
                }`}>
                  {actual < 0 && !isAssetAccount(account.type) ? '' : actual < 0 ? '−' : ''}{formatCurrency(Math.abs(actual))}
                </span>

                {/* Projected balance — diff stacks above when positive, below when negative */}
                <div className="text-right sm:w-24 flex flex-col items-end">
                  {diff > 0 && (
                    <span className={`text-[10px] font-medium ${positiveDiffColor}`}>
                      +{formatCurrency(Math.abs(diff))}
                    </span>
                  )}
                  <span className={`text-xs sm:text-sm font-semibold tabular-nums ${
                    projected >= 0 ? 'text-violet-600 dark:text-violet-400' : 'text-red-600 dark:text-red-400'
                  }`}>
                    {projected < 0 && !isAssetAccount(account.type) ? '' : projected < 0 ? '−' : ''}{formatCurrency(Math.abs(projected))}
                  </span>
                  {diff < 0 && (
                    <span className={`text-[10px] font-medium ${negativeDiffColor}`}>
                      −{formatCurrency(Math.abs(diff))}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </section>
  );
}



function AccountTypeIcon({ type }) {
  const iconClass = 'h-5 w-5';
  const wrapperBase = 'flex h-9 w-9 items-center justify-center rounded-xl';

  switch (type) {
    case 'checking':
      return (
        <div className={`${wrapperBase} bg-teal-100 dark:bg-teal-900/40`}>
          <svg className={`${iconClass} text-teal-800 dark:text-teal-300`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18-3H3m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6m18 0V5.625A2.625 2.625 0 0018.375 3H5.625A2.625 2.625 0 003 5.625V6" />
          </svg>
        </div>
      );
    case 'savings':
      return (
        <div className={`${wrapperBase} bg-green-200 dark:bg-green-900/40`}>
          <svg className={`${iconClass} text-green-700 dark:text-green-300`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        </div>
      );
    case 'credit_card':
      return (
        <div className={`${wrapperBase} bg-red-200 dark:bg-red-900/40`}>
          <svg className={`${iconClass} text-red-700 dark:text-red-300`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
        </div>
      );
    case 'retirement':
      return (
        <div className={`${wrapperBase} bg-violet-200 dark:bg-violet-900/40`}>
          <svg className={`${iconClass} text-violet-700 dark:text-violet-300`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
          </svg>
        </div>
      );
    case 'brokerage':
      return (
        <div className={`${wrapperBase} bg-fuchsia-200 dark:bg-fuchsia-900/40`}>
          <svg className={`${iconClass} text-fuchsia-700 dark:text-fuchsia-300`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
          </svg>
        </div>
      );
    case 'loan':
      return (
        <div className={`${wrapperBase} bg-yellow-100 dark:bg-yellow-900/40`}>
          <svg className={`${iconClass} text-yellow-700 dark:text-yellow-300`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
        </div>
      );
    case 'mortgage':
      return (
        <div className={`${wrapperBase} bg-orange-100 dark:bg-orange-900/40`}>
          <svg className={`${iconClass} text-orange-600 dark:text-orange-300`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        </div>
      );
    default:
      return (
        <div className={`${wrapperBase} bg-stone-100 dark:bg-stone-900/40`}>
          <svg className={`${iconClass} text-stone-500 dark:text-stone-300`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      );
  }
}
