import { useState } from 'react';
import { formatCurrency, maskAccountName } from '../../utils/helpers';
import { ACCOUNT_TYPES, isAssetAccount, getAccountBadgeColor } from '../../services/accounts';

/**
 * AccountList — displays accounts grouped by Asset / Liability with balances.
 *
 * Props:
 *  - accounts: Array of account objects with `balance` and `projected_balance` fields
 *  - onViewTransactions(accountId): navigate to filtered transaction view
 */
export default function AccountList({ accounts, onViewTransactions }) {
  if (!accounts || accounts.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200/60 bg-white p-12 text-center shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 dark:bg-stone-700">
          <svg className="h-7 w-7 text-stone-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
        </div>
        <p className="text-base text-stone-500 dark:text-stone-400">No accounts yet.</p>
        <p className="mt-1 text-sm text-stone-400 dark:text-stone-500">
          Add your first account to start tracking your net worth.
        </p>
      </div>
    );
  }

  // Group accounts
  const assetAccounts = accounts.filter((a) => isAssetAccount(a.type));
  const liabilityAccounts = accounts.filter((a) => !isAssetAccount(a.type));

  const actualTotal = (list) => list.reduce((sum, a) => sum + a.balance, 0);
  const projectedTotal = (list) => list.reduce((sum, a) => sum + (a.projected_balance ?? a.balance), 0);

  const hasBoth = assetAccounts.length > 0 && liabilityAccounts.length > 0;

  return (
    <div className={hasBoth ? 'grid gap-6 lg:grid-cols-2' : 'space-y-6'}>
      {/* Asset Accounts */}
      {assetAccounts.length > 0 && (
        <AccountGroup
          title="Assets"
          accounts={assetAccounts}
          total={actualTotal(assetAccounts)}
          projectedTotal={projectedTotal(assetAccounts)}
          totalColor="text-emerald-600 dark:text-emerald-400"
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
          totalColor="text-red-600 dark:text-red-400"
          onViewTransactions={onViewTransactions}
        />
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
    <div className="rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 overflow-hidden dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      {/* Group header — also serves as column labels; widths match data row cells */}
      <div className="flex items-center justify-between border-b border-stone-200/60 bg-stone-50/50 px-4 sm:px-6 py-3 dark:border-stone-700/60 dark:bg-stone-700/30">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{title}</h3>
        <div className="flex flex-col items-end sm:flex-row sm:items-center sm:gap-6">
          <div className="sm:w-24 text-right">
            <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Actual</p>
            <span className={`text-sm sm:text-base font-bold tabular-nums ${totalColor}`}>
              {formatCurrency(Math.abs(total))}
            </span>
          </div>
          <div className="sm:w-24 text-right">
            <p className="text-[10px] font-medium uppercase tracking-wider text-violet-400 dark:text-violet-500">Projected</p>
            <span className="text-sm sm:text-base font-bold tabular-nums text-violet-600 dark:text-violet-400">
              {formatCurrency(Math.abs(projectedTotal))}
            </span>
          </div>
        </div>
      </div>

      {/* Account rows */}
      <div className="divide-y divide-stone-100 dark:divide-stone-700/50">
        {accounts.map((account) => {
          const actual = account.balance;
          const projected = account.projected_balance ?? account.balance;
          const diff = projected - actual;
          return (
            <div
              key={account.id}
              className="group flex items-center justify-between px-4 sm:px-6 py-3 sm:py-3.5 transition-colors hover:bg-stone-50/50 dark:hover:bg-stone-700/30"
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
                    className="text-sm font-semibold text-stone-900 hover:text-amber-600 transition-colors line-clamp-2 block dark:text-stone-100 dark:hover:text-amber-400"
                    title="View transactions for this account"
                  >
                    {maskAccountName(account.name)}
                  </button>
                  <span className={`hidden sm:inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${getAccountBadgeColor(account.type)} mt-0.5`}>
                    {ACCOUNT_TYPES[account.type]?.label || account.type}
                  </span>
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
                    <span className="text-[10px] font-medium text-emerald-500 dark:text-emerald-400">
                      +{formatCurrency(Math.abs(diff))}
                    </span>
                  )}
                  <span className={`text-xs sm:text-sm font-semibold tabular-nums ${
                    projected >= 0 ? 'text-violet-600 dark:text-violet-400' : 'text-red-600 dark:text-red-400'
                  }`}>
                    {projected < 0 && !isAssetAccount(account.type) ? '' : projected < 0 ? '−' : ''}{formatCurrency(Math.abs(projected))}
                  </span>
                  {diff < 0 && (
                    <span className="text-[10px] font-medium text-red-400 dark:text-red-500">
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
  );
}



function AccountTypeIcon({ type }) {
  const iconClass = 'h-5 w-5';
  const wrapperBase = 'flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl dark:opacity-90';

  switch (type) {
    case 'checking':
      return (
        <div className={`${wrapperBase} bg-teal-100`}>
          <svg className={`${iconClass} text-teal-800`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18-3H3m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6m18 0V5.625A2.625 2.625 0 0018.375 3H5.625A2.625 2.625 0 003 5.625V6" />
          </svg>
        </div>
      );
    case 'savings':
      return (
        <div className={`${wrapperBase} bg-green-200`}>
          <svg className={`${iconClass} text-green-700`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        </div>
      );
    case 'credit_card':
      return (
        <div className={`${wrapperBase} bg-red-200`}>
          <svg className={`${iconClass} text-red-700`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
        </div>
      );
    case 'retirement':
      return (
        <div className={`${wrapperBase} bg-violet-200`}>
          <svg className={`${iconClass} text-violet-700`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
          </svg>
        </div>
      );
    case 'brokerage':
      return (
        <div className={`${wrapperBase} bg-fuchsia-200`}>
          <svg className={`${iconClass} text-fuchsia-700`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
          </svg>
        </div>
      );
    case 'loan':
      return (
        <div className={`${wrapperBase} bg-yellow-100`}>
          <svg className={`${iconClass} text-yellow-700`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
        </div>
      );
    case 'mortgage':
      return (
        <div className={`${wrapperBase} bg-orange-100`}>
          <svg className={`${iconClass} text-orange-600`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        </div>
      );
    default:
      return (
        <div className={`${wrapperBase} bg-stone-100`}>
          <svg className={`${iconClass} text-stone-500`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      );
  }
}
