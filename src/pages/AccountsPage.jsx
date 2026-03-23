import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountForm from '../components/accounts/AccountForm';
import AccountList from '../components/accounts/AccountList';
import NetWorthSummary from '../components/accounts/NetWorthSummary';
import Modal from '../components/common/Modal';
import TopBar from '../components/common/TopBar';
import {
  getAccountBalancesOffline as getAccountBalances,
  createAccountOffline as createAccount,
  updateAccountOffline as updateAccount,
  deleteAccountOffline as deleteAccount,
  getNetWorthHistoryOffline as getNetWorthHistory,
  getMaxProjectedDateOffline as getMaxProjectedDate,
  closeAccountOffline as closeAccount,
  reopenAccountOffline as reopenAccount,
  pauseRecurringTemplateOffline as pauseTemplate,
  resumeRecurringTemplateOffline as resumeTemplate,
  getTemplatesForAccountOffline as getTemplatesForAccount,
} from '../services/offlineAware';
import { getFavoriteAccountIds, setFavoriteAccountIds } from '../services/accounts';

// ================================================
// AccountsPage
// ================================================
export default function AccountsPage() {
  const navigate = useNavigate();

  // Data state
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [favoriteAccountIds, setFavoriteAccountIdsState] = useState([]);

  // Chart state
  const [chartData, setChartData] = useState([]);
  const [projectedChartData, setProjectedChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(true);

  // Modal state
  const [showManagerModal, setShowManagerModal] = useState(false);

  // Projected-to-date
  const [projectedToDate, setProjectedToDate] = useState(null);
  const [maxProjectedDate, setMaxProjectedDate] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => { document.title = 'Budget App | Accounts'; }, []);

  // ---------- Load data ----------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setLoadError('');
      setChartLoading(true);
      try {
        const [data, nwHistory, maxDate] = await Promise.all([
          getAccountBalances(),
          getNetWorthHistory(),
          getMaxProjectedDate(),
        ]);
        const favIds = await getFavoriteAccountIds().catch(() => []);
        if (!cancelled) {
          setAccounts(data);
          setFavoriteAccountIdsState(favIds);
          setChartData(nwHistory.history ?? nwHistory);
          setProjectedChartData(nwHistory.projectedFuture ?? []);
          if (maxDate && !projectedToDate) {
            setProjectedToDate(maxDate);
          }
          setMaxProjectedDate(maxDate);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err?.message || 'Failed to load accounts.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setChartLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: initial load only, projectedToDate starts null

  async function refreshAccounts(opts = {}) {
    const toDate = opts.projectedToDate !== undefined ? opts.projectedToDate : projectedToDate;
    try {
      const [data, nwHistory] = await Promise.all([
        getAccountBalances({ projectedToDate: toDate }),
        getNetWorthHistory({ projectedToDate: toDate }),
      ]);
      setAccounts(data);
      setChartData(nwHistory.history ?? nwHistory);
      setProjectedChartData(nwHistory.projectedFuture ?? []);
    } catch (err) {
      setLoadError(err?.message || 'Failed to refresh accounts.');
    }
  }

  function handleProjectedToDateChange(e) {
    const val = e.target.value || null;
    setProjectedToDate(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refreshAccounts({ projectedToDate: val });
    }, 400);
  }

  // ---------- CRUD ----------
  async function handleManageSubmit(values) {
    if (values.id) {
      const { id, ...updates } = values;
      await updateAccount(id, updates);
    } else {
      await createAccount(values);
    }
    setShowManagerModal(false);
    await refreshAccounts();
  }

  async function handleToggleFavorite(id) {
    const next = favoriteAccountIds.includes(id)
      ? favoriteAccountIds.filter((fid) => fid !== id)
      : [...favoriteAccountIds, id];
    setFavoriteAccountIdsState(next);
    await setFavoriteAccountIds(next).catch(() => {});
  }

  async function handleManageDelete(id) {
    await deleteAccount(id);
    setShowManagerModal(false);
    await refreshAccounts();
  }

  async function handleManageClose(id, closedAt) {
    // Pause linked recurring templates
    const templates = await getTemplatesForAccount(id);
    for (const t of templates) {
      if (!t.is_paused) await pauseTemplate(t.id);
    }
    await closeAccount(id, closedAt);
    setShowManagerModal(false);
    await refreshAccounts();
  }

  async function handleManageReopen(id) {
    // Resume paused recurring templates linked to this account
    const templates = await getTemplatesForAccount(id);
    for (const t of templates) {
      if (t.is_paused) await resumeTemplate(t.id);
    }
    await reopenAccount(id);
    setShowManagerModal(false);
    await refreshAccounts();
  }

  function handleViewTransactions(accountId) {
    navigate(`/app/transactions?account=${accountId}`);
  }

  // ---------- Computed ----------
  const totalAssets = accounts.filter((a) => a.is_asset).reduce((sum, a) => sum + a.balance, 0);
  const totalLiabilities = accounts.filter((a) => !a.is_asset).reduce((sum, a) => sum + a.balance, 0);
  const netWorth = totalAssets - totalLiabilities;

  const projectedTotalAssets = accounts.filter((a) => a.is_asset).reduce((sum, a) => sum + (a.projected_balance ?? a.balance), 0);
  const projectedTotalLiabilities = accounts.filter((a) => !a.is_asset).reduce((sum, a) => sum + (a.projected_balance ?? a.balance), 0);
  const projectedNetWorth = projectedTotalAssets - projectedTotalLiabilities;

  // Detect negative asset account balances — may indicate inverted imports
  // Exclude closed accounts from this warning
  const negativeAssets = accounts.filter((a) => a.is_asset && a.balance < 0 && !a.closed_at);
  const hasNegativeAssets = negativeAssets.length > 0;

  // ---------- Render ----------
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <TopBar pageName="Accounts" />

      {/* Main content */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Page header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">Accounts</h1>
            <p className="mt-2 text-base text-stone-500 dark:text-stone-400">
              Track your accounts and monitor your net worth.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => setShowManagerModal(true)}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Manage Accounts
            </button>
            {maxProjectedDate && (
              <div className="flex items-center gap-2">
                <label htmlFor="projected-to-date" className="text-sm font-medium text-stone-600 dark:text-stone-400 whitespace-nowrap">
                  Project to:
                </label>
                <input
                  id="projected-to-date"
                  type="date"
                  value={projectedToDate ?? ''}
                  min={(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })()}
                  max={maxProjectedDate}
                  onChange={handleProjectedToDateChange}
                  className="rounded-lg border border-stone-200/80 bg-stone-50/80 px-3 py-1.5 text-sm text-stone-800 shadow-sm transition-colors focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-200 dark:focus:border-amber-500"
                />
                {projectedToDate && projectedToDate !== maxProjectedDate && (
                  <button
                    type="button"
                    onClick={() => { setProjectedToDate(maxProjectedDate); refreshAccounts({ projectedToDate: maxProjectedDate }); }}
                    className="text-xs font-medium text-stone-400 hover:text-amber-600 transition-colors dark:hover:text-amber-400"
                  >
                    Reset to max
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Error banner */}
        {loadError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <span className="mr-1.5">⚠</span>{loadError}
          </div>
        )}

        {/* Net Worth Summary */}
        <div className="mb-6">
          <NetWorthSummary
            netWorth={netWorth}
            totalAssets={totalAssets}
            totalLiabilities={totalLiabilities}
            projectedNetWorth={projectedNetWorth}
            isLoading={isLoading}
            chartData={chartData}
            projectedChartData={projectedChartData}
            chartLoading={chartLoading}
          />
        </div>

        {/* Negative asset balance warning */}
        {!isLoading && hasNegativeAssets && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
            <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {negativeAssets.length === 1
                  ? `"${negativeAssets[0].name}" has a negative balance`
                  : `${negativeAssets.length} asset accounts have negative balances`}
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Asset accounts with negative balances may indicate that imported transactions have income/expense reversed.
                Review the transactions on {negativeAssets.length === 1 ? 'this account' : 'these accounts'} and consider re-importing with corrected column mapping.
              </p>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-stone-200/60 dark:bg-stone-700/60"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : (
          <AccountList
            accounts={accounts}
            onViewTransactions={handleViewTransactions}
          />
        )}
      </div>

      {/* Manage accounts modal */}
      {showManagerModal && (
        <Modal title="Manage Accounts" onClose={() => setShowManagerModal(false)}>
          <AccountForm
            accounts={accounts}
            onSubmit={handleManageSubmit}
            onDelete={handleManageDelete}
            onClose={handleManageClose}
            onReopen={handleManageReopen}
            onCancel={() => setShowManagerModal(false)}
            favoriteAccountIds={favoriteAccountIds}
            onToggleFavorite={handleToggleFavorite}
          />
        </Modal>
      )}
    </div>
  );
}
