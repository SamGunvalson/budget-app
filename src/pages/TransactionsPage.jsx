import { useCallback, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import TransactionForm from '../components/transactions/TransactionForm';
import TransactionList from '../components/transactions/TransactionList';
import TransactionFilters from '../components/transactions/TransactionFilters';
import BulkActionBar from '../components/transactions/BulkActionBar';
import RecurringForm from '../components/transactions/RecurringForm';
import RecurringGroupForm from '../components/transactions/RecurringGroupForm';
import UpcomingRecurring from '../components/reports/UpcomingRecurring';
import Modal, { ConfirmDeleteModal } from '../components/common/Modal';
import TopBar from '../components/common/TopBar';
import useTransactionManager from '../hooks/useTransactionManager';
import { getCategoriesOffline as getCategories } from '../services/offlineAware';
import { getAccountsOffline as getAccounts } from '../services/offlineAware';
import {
  getTransactionsOffline as getTransactions,
  createTransactionOffline as createTransaction,
  getTransactionsForYearOffline as getTransactionsForYear,
  getAccountBalancesOffline,
} from '../services/offlineAware';
import {
  createTransfer,
  createLinkedTransfer,
  createAdjustment,
  bulkUpdateTransactions,
  bulkDeleteTransactions,
} from '../services/transactions';
import BulkEditModal from '../components/transactions/BulkEditModal';
import {
  createRecurringTemplate,
  updateRecurringTemplate,
  createRecurringGroup,
  updateRecurringGroup,
  generateProjectedTransactions,
  clearProjectedTransactionsForTemplate,
  getRecurringTemplateById,
  getRecurringTemplates,
} from '../services/recurring';
import { buildTemplateLookup, groupTransactions } from '../utils/transactionGrouping';
import { toCents } from '../utils/helpers';
import { isAssetAccount, getFavoriteAccountIds } from '../services/accounts';
import useMonthYear from '../hooks/useMonthYear';
import useSessionState from '../hooks/useSessionState';
import { getPartnership, getPartnerEmail, getPartnerId } from '../services/partnerships';
import { createSplitExpense, getSplitTransactionIds, getSplitByTransaction, deleteSplitExpense, computeShares } from '../services/splitExpenses';
import { getCurrentUser } from '../services/supabase';
import SplitExpenseForm from '../components/splits/SplitExpenseForm';

// ================================================
// TransactionsPage
// ================================================
export default function TransactionsPage() {
  const { month, year, setMonthYear } = useMonthYear();
  const [searchParams] = useSearchParams();
  const accountFilterParam = searchParams.get('account') || '';

  // Data state
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [accountBalances, setAccountBalances] = useState([]);
  const [favoriteAccountIds, setFavoriteAccountIds] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Period state
  const [viewMode, setViewMode] = useSessionState('transactionsViewMode', 'monthly'); // 'monthly' | 'yearly'

  // Incremented each time a load completes — used to trigger scroll-to-posted
  const [dataLoadKey, setDataLoadKey] = useState(0);

  // Filter state
  const [filters, setFilters] = useState({
    searchText: '',
    categoryId: '',
    accountId: accountFilterParam,
    type: 'all', // 'all' | 'income' | 'expense' | 'transfer'
    statusFilter: 'all', // 'all' | 'posted' | 'pending' | 'projected'
    amountExact: '',
    dateStart: '',
    dateEnd: '',
  });

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRecurringPanel, setShowRecurringPanel] = useState(false);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);
  const [recurringKey, setRecurringKey] = useState(0);
  const [bulkEditGroup, setBulkEditGroup] = useState(null); // Transaction[] for bulk edit modal
  const [deletingGroup, setDeletingGroup] = useState(null); // Transaction[] pending group delete
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);

  // Grouping state
  const [recurringTemplates, setRecurringTemplates] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const toggleGroupExpand = useCallback((groupKey) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  // Split state
  const [partnership, setPartnership] = useState(null);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [partnerId, setPartnerId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [splitTransactionIds, setSplitTransactionIds] = useState(new Set());
  const [splittingTransaction, setSplittingTransaction] = useState(null);
  const [splitLoading, setSplitLoading] = useState(false);

  // Transaction management hook
  const handleError = useCallback((msg) => setLoadError(msg), []);
  const mgr = useTransactionManager({
    transactions,
    setTransactions,
    onError: handleError,
  });
  const { reset } = mgr;

  useEffect(() => { document.title = 'Budget App | Transactions'; }, []);

  // Load partnership + split transaction IDs (once)
  useEffect(() => {
    async function loadPartnership() {
      try {
        const [user, p] = await Promise.all([getCurrentUser(), getPartnership()]);
        setCurrentUser(user);
        setPartnership(p);
        if (p && user) {
          setPartnerEmail(await getPartnerEmail(p, user.id));
          setPartnerId(getPartnerId(p, user.id));
          const ids = await getSplitTransactionIds(p.id);
          setSplitTransactionIds(ids);
        }
      } catch { /* non-fatal */ }
    }
    loadPartnership();
  }, []);

  // ---------- Load data ----------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setLoadError('');
      // Clear selection & edits on period change
      reset();
      try {
        const txPromise = viewMode === 'yearly'
          ? getTransactionsForYear({ year })
          : getTransactions({ month, year });
        const [txData, catData, acctData, balData] = await Promise.all([txPromise, getCategories(), getAccounts(), getAccountBalancesOffline()]);
        const favIds = await getFavoriteAccountIds().catch(() => []);
        if (!cancelled) {
          setTransactions(txData);
          setCategories(catData);
          setAccounts(acctData);
          setAccountBalances(balData);
          setFavoriteAccountIds(favIds);
          setDataLoadKey((k) => k + 1);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err?.message || 'Failed to load transactions.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [month, year, viewMode, reset]);

  // ---------- Load recurring templates (for grouping) ----------
  useEffect(() => {
    let cancelled = false;
    getRecurringTemplates()
      .then((data) => { if (!cancelled) setRecurringTemplates(data); })
      .catch(() => {}); // non-fatal
    return () => { cancelled = true; };
  }, [recurringKey]); // refresh when recurring templates change

  const templateLookup = useMemo(
    () => buildTemplateLookup(recurringTemplates),
    [recurringTemplates],
  );

  // ---------- Client-side filter & sort ----------
  const filteredSorted = useMemo(() => {
    let result = [...transactions];

    // Text search (description + payee)
    if (filters.searchText) {
      const q = filters.searchText.toLowerCase();
      result = result.filter(
        (t) =>
          (t.description || '').toLowerCase().includes(q) ||
          (t.payee || '').toLowerCase().includes(q)
      );
    }

    // Category filter
    if (filters.categoryId) {
      result = result.filter((t) => t.category_id === filters.categoryId);
    }

    // Account filter
    if (filters.accountId) {
      result = result.filter((t) => t.account_id === filters.accountId);
    }

    // Status filter
    if (filters.statusFilter && filters.statusFilter !== 'all') {
      result = result.filter((t) => t.status === filters.statusFilter);
    }

    // Type filter
    if (filters.type === 'income') {
      result = result.filter((t) => t.is_income && t.categories?.type !== 'transfer');
    } else if (filters.type === 'expense') {
      result = result.filter((t) => !t.is_income && t.categories?.type !== 'transfer');
    } else if (filters.type === 'transfer') {
      result = result.filter((t) => t.categories?.type === 'transfer');
    }

    // Exact amount search
    if (filters.amountExact) {
      const targetCents = toCents(Math.abs(Number(filters.amountExact)));
      result = result.filter((t) => Math.abs(t.amount) === targetCents);
    }

    // Date range
    if (filters.dateStart) {
      result = result.filter((t) => t.transaction_date >= filters.dateStart);
    }
    if (filters.dateEnd) {
      result = result.filter((t) => t.transaction_date <= filters.dateEnd);
    }

    // Sort
    result.sort((a, b) => {
      let aVal, bVal;
      switch (mgr.sortColumn) {
        case 'transaction_date':
          aVal = a.transaction_date;
          bVal = b.transaction_date;
          break;
        case 'description':
          aVal = (a.description || '').toLowerCase();
          bVal = (b.description || '').toLowerCase();
          break;
        case 'payee':
          aVal = (a.payee || '').toLowerCase();
          bVal = (b.payee || '').toLowerCase();
          break;
        case 'category':
          aVal = (a.categories?.name || '').toLowerCase();
          bVal = (b.categories?.name || '').toLowerCase();
          break;
        case 'account':
          aVal = (a.accounts?.name || '').toLowerCase();
          bVal = (b.accounts?.name || '').toLowerCase();
          break;
        case 'amount':
          aVal = Math.abs(a.amount);
          bVal = Math.abs(b.amount);
          break;
        default:
          aVal = a.transaction_date;
          bVal = b.transaction_date;
      }
      if (aVal < bVal) return mgr.sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return mgr.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [transactions, filters, mgr.sortColumn, mgr.sortDirection]);

  // ---------- Group transactions for display ----------
  const groupedItems = useMemo(
    () => groupTransactions(filteredSorted, templateLookup),
    [filteredSorted, templateLookup],
  );

  // ---------- Index of first posted transaction in the sorted+filtered list ----------
  const firstPostedIndex = useMemo(
    () => Math.max(0, filteredSorted.findIndex((t) => t.status === 'posted')),
    [filteredSorted]
  );

  // ---------- Running balance per transaction (unfiltered, cumulative) ----------
  const balanceMap = useMemo(() => {
    if (!accountBalances.length || !transactions.length) return new Map();

    // Today's date string — same cutoff used by getAccountBalances when computing info.balance.
    // info.balance only includes posted transactions with transaction_date <= todayStr.
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Build lookup: account_id → { balance (current cumulative in cents), is_asset }
    const balLookup = {};
    for (const ab of accountBalances) {
      balLookup[ab.id] = { balance: ab.balance, is_asset: isAssetAccount(ab.type) };
    }

    // Group all unfiltered transactions by account
    const byAccount = {};
    for (const tx of transactions) {
      if (!byAccount[tx.account_id]) byAccount[tx.account_id] = [];
      byAccount[tx.account_id].push(tx);
    }

    const map = new Map();

    for (const [accountId, txs] of Object.entries(byAccount)) {
      const info = balLookup[accountId];
      if (!info) continue;

      // Sort ascending by date, then by is_income (expenses first) for same-date stability
      const sorted = [...txs].sort((a, b) => {
        const d = a.transaction_date.localeCompare(b.transaction_date);
        if (d !== 0) return d;
        return (a.is_income ? 1 : 0) - (b.is_income ? 1 : 0);
      });

      // Back out only the transactions that are already included in info.balance:
      // posted transactions on or before today. This matches the getAccountBalances cutoff
      // exactly, so `running` starts at the correct opening balance before this period.
      let periodNet = 0;
      for (const tx of sorted) {
        if (tx.status !== 'posted' || tx.transaction_date > todayStr) continue;
        const amt = Math.abs(tx.amount);
        const delta = info.is_asset
          ? (tx.is_income ? amt : -amt)
          : (tx.is_income ? -amt : amt);
        periodNet += delta;
      }

      // Opening balance before the first transaction in this set
      let running = info.balance - periodNet;

      // Walk forward through ALL transactions (posted + pending + projected) to build a
      // forecast balance. This lets users see what their account balance will look like
      // assuming every upcoming transaction goes through as planned.
      for (const tx of sorted) {
        const amt = Math.abs(tx.amount);
        const delta = info.is_asset
          ? (tx.is_income ? amt : -amt)
          : (tx.is_income ? -amt : amt);
        running += delta;
        map.set(tx.id, running);
      }
    }

    return map;
  }, [transactions, accountBalances]);

  // ---------- Sort handler ----------
  // (provided by mgr.handleSort)

  // ---------- CRUD handlers ----------
  const handleCreate = async (values) => {
    const { isSplit, ...rest } = values;
    const created = await createTransaction(rest);
    setTransactions((prev) => [created, ...prev]);
    setShowCreateModal(false);
    if (isSplit && partnership) {
      setSplittingTransaction(created);
    }
  };

  const handleCreateTransfer = async (values) => {
    const [outgoing, incoming] = await createTransfer(values);
    setTransactions((prev) => [outgoing, incoming, ...prev]);
    setShowCreateModal(false);
  };

  const handleCreateLinkedTransfer = async (values) => {
    const { isSplit, ...rest } = values;
    const [mainLeg, companionLeg] = await createLinkedTransfer(rest);
    setTransactions((prev) => [mainLeg, companionLeg, ...prev]);
    setShowCreateModal(false);
    if (isSplit && partnership) {
      setSplittingTransaction(mainLeg);
    }
  };

  const handleCreateAdjustment = async (values) => {
    const created = await createAdjustment(values);
    setTransactions((prev) => [created, ...prev]);
    setShowCreateModal(false);
  };

  // ---------- Update wrappers (intercept isSplit) ----------
  const handleUpdateWithSplit = async (values) => {
    const { isSplit, ...rest } = values;
    const editingTx = mgr.editingTransaction;
    await mgr.handleUpdate(rest);
    if (isSplit && partnership && editingTx) {
      setSplittingTransaction({
        id: editingTx.id,
        payee: rest.payee,
        description: rest.description,
        amount: rest.amount,
        transaction_date: rest.transaction_date,
      });
    }
  };

  const handleUpdateLinkedTransferWithSplit = async (values) => {
    const { isSplit, ...rest } = values;
    const editingTx = mgr.editingTransaction;
    await mgr.handleUpdateLinkedTransfer(rest);
    if (isSplit && partnership && editingTx) {
      setSplittingTransaction({
        id: editingTx.id,
        payee: rest.payee,
        description: rest.description,
        amount: rest.amount,
        transaction_date: rest.transaction_date,
      });
    }
  };

  // ---------- Recurring handlers ----------
  const handleCreateRecurring = async (values) => {
    await createRecurringTemplate(values);
    // Generate projected transactions immediately so they appear without a page refresh
    await generateProjectedTransactions().catch((err) =>
      console.warn('Failed to generate projections after recurring create:', err)
    );
    setShowRecurringForm(false);
    setRecurringKey((k) => k + 1); // refresh the panel
  };

  const handleUpdateRecurring = async (values) => {
    // Clear stale projected/pending transactions so they're regenerated with the updated type
    await clearProjectedTransactionsForTemplate(editingTemplate.id).catch((err) =>
      console.warn('Failed to clear projected transactions before template update:', err)
    );
    await updateRecurringTemplate(editingTemplate.id, values);
    // Regenerate projections using the updated template settings
    await generateProjectedTransactions().catch((err) =>
      console.warn('Failed to generate projections after recurring update:', err)
    );
    setEditingTemplate(null);
    setRecurringKey((k) => k + 1);
  };

  const handleEditTemplate = (template) => {
    setEditingTemplate(template);
  };

  const handleEditGroup = (group) => {
    setEditingGroup(group);
  };

  // ---------- Group bulk handlers ----------
  const handleConfirmAll = (children) => {
    children
      .filter((c) => c.status !== 'posted')
      .forEach((c) => handleConfirmWithSplit(c.id));
  };

  const handleSkipAll = (children) => {
    children
      .filter((c) => c.status !== 'posted')
      .forEach((c) => mgr.handleSkip(c.id));
  };

  const handleEditAll = (children) => {
    setBulkEditGroup(children);
  };

  const handleDeleteAll = (children) => {
    setDeletingGroup(children);
  };

  const handleBulkEditSubmit = async (fields) => {
    if (!bulkEditGroup) return;
    const updates = bulkEditGroup.map((c) => ({ id: c.id, ...fields }));
    await bulkUpdateTransactions(updates);
    // Refresh local state
    setTransactions((prev) =>
      prev.map((t) => {
        const update = updates.find((u) => u.id === t.id);
        if (!update) return t;
        const { id: _id, ...rest } = update;
        return { ...t, ...rest };
      })
    );
    setBulkEditGroup(null);
  };

  const handleDeleteGroupConfirm = async () => {
    if (!deletingGroup) return;
    setIsDeletingGroup(true);
    try {
      await bulkDeleteTransactions(deletingGroup.map((c) => c.id));
      setTransactions((prev) =>
        prev.filter((t) => !deletingGroup.some((c) => c.id === t.id))
      );
      setDeletingGroup(null);
    } catch (err) {
      setLoadError(err?.message || 'Failed to delete transactions.');
    } finally {
      setIsDeletingGroup(false);
    }
  };

  // ---------- Confirm with auto-split ----------
  const handleConfirmWithSplit = async (txId) => {
    const tx = transactions.find((t) => t.id === txId);
    await mgr.handleConfirm(txId);
    if (tx?.recurring_template_id && partnership && currentUser) {
      try {
        const tpl = await getRecurringTemplateById(tx.recurring_template_id);
        if (tpl && tpl.is_split && !tpl.is_transfer) {
          const pid = getPartnerId(partnership, currentUser.id);
          const { payerShare, partnerShare, paidByUserId } = computeShares(
            Math.abs(tpl.amount),
            tpl.split_method,
            tpl.split_payer,
            tpl.split_partner_share_pct,
            currentUser.id,
            pid,
          );
          await createSplitExpense({
            partnershipId: partnership.id,
            description: tx.description || tpl.description,
            totalAmount: Math.abs(tpl.amount),
            payerShare,
            partnerShare,
            paidByUserId,
            transactionId: txId,
            expenseDate: tx.transaction_date,
          });
          setSplitTransactionIds((prev) => new Set([...prev, txId]));
        }
      } catch (err) {
        console.warn('handleConfirmWithSplit: failed to create split expense:', err?.message);
      }
    }
  };

  const handleCreateGroup = async (parentData, childrenData) => {

    await createRecurringGroup(parentData, childrenData);
    // Generate projected transactions immediately so they appear without a page refresh
    await generateProjectedTransactions().catch((err) =>
      console.warn('Failed to generate projections after group create:', err)
    );
    setShowGroupForm(false);
    setRecurringKey((k) => k + 1);
  };

  const handleUpdateGroup = async (parentData, childrenData) => {
    if (!editingGroup) return;
    // Clear stale projected/pending transactions for the parent and all current children
    const clearIds = [editingGroup.id, ...(editingGroup.children || []).map((c) => c.id)];
    await Promise.all(
      clearIds.map((id) => clearProjectedTransactionsForTemplate(id).catch(() => {}))
    );
    await updateRecurringGroup(editingGroup.id, parentData, childrenData);
    // Regenerate projections using the updated template settings
    await generateProjectedTransactions().catch((err) =>
      console.warn('Failed to generate projections after group update:', err)
    );
    setEditingGroup(null);
    setRecurringKey((k) => k + 1);
  };

  const handleRecurringApplied = (result) => {
    if (result.applied > 0) {
      // Refresh transactions to show newly created ones
      const txPromise = viewMode === 'yearly'
        ? getTransactionsForYear({ year })
        : getTransactions({ month, year });
      txPromise.then(setTransactions).catch(() => {});
    }
  };

  // ---------- Render ----------
  return (
    <div className="min-h-screen bg-linear-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <TopBar pageName="Transactions" />

      {/* Main content */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Page header */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">Transactions</h1>
            <p className="mt-2 text-base text-stone-500 dark:text-stone-400">
              Track your income and expenses.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 sm:gap-3">
            <button
              type="button"
              title="Recurring"
              onClick={() => setShowRecurringPanel((v) => !v)}
              className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-sm font-medium shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 sm:px-5 sm:py-2.5 ${
                showRecurringPanel
                  ? 'border-violet-300 bg-violet-500 text-white shadow-md shadow-violet-200/50'
                  : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:shadow-md dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
              </svg>
              <span className="hidden sm:inline">Recurring</span>
            </button>
            <button
              type="button"
              title="New Transaction"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-2.5 py-2 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] sm:px-5 sm:py-2.5"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span className="hidden sm:inline">New Transaction</span>
            </button>
          </div>
        </div>

        {/* Recurring panel */}
        {showRecurringPanel && (
          <div className="animate-fade-in mb-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Recurring Transactions</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowRecurringForm(true)}
                  className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:bg-violet-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 active:scale-[0.98]"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Recurring
                </button>
                <button
                  type="button"
                  onClick={() => setShowGroupForm(true)}
                  className="flex items-center gap-2 rounded-xl border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-600 shadow-sm transition-all hover:bg-violet-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 active:scale-[0.98] dark:border-violet-700 dark:bg-stone-800 dark:text-violet-400 dark:hover:bg-stone-700"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                  </svg>
                  New Group
                </button>
              </div>
            </div>
            <UpcomingRecurring
              key={recurringKey}
              onApplied={handleRecurringApplied}
              onEdit={handleEditTemplate}
              onEditGroup={handleEditGroup}
            />
          </div>
        )}

        {/* View mode toggle — always visible so you can switch mid-load */}
        {isLoading && (
          <div className="mb-6">
            <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50/50 p-1 dark:border-stone-700 dark:bg-stone-700/50">
              {['monthly', 'yearly'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                    viewMode === mode
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100'
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filters (full bar — only after load to avoid debounce setState loop) */}
        {!isLoading && (
          <div className="mb-6">
            <TransactionFilters
                categories={categories}
                accounts={accounts}
                filters={filters}
                onFiltersChange={setFilters}
                viewMode={viewMode}
                month={month}
                year={year}
                onMonthChange={(m) => setMonthYear(m, year)}
                onYearChange={(y) => setMonthYear(month, y)}
                onViewModeChange={setViewMode}
                resultCount={filteredSorted.length}
              />
            </div>
        )}

        {/* Error banner */}
        {loadError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <span className="mr-1.5">⚠</span>{loadError}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(viewMode === 'yearly' ? 10 : 5)].map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-stone-200/60 dark:bg-stone-700/60"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
            {viewMode === 'yearly' && (
              <p className="pt-2 text-center text-sm text-stone-400 dark:text-stone-500">
                Loading all transactions for {year}…
              </p>
            )}
          </div>
        ) : (
          <TransactionList
            transactions={filteredSorted}
            groupedItems={groupedItems}
            expandedGroups={expandedGroups}
            onToggleGroupExpand={toggleGroupExpand}
            scrollKey={dataLoadKey}
            initialScrollToIndex={firstPostedIndex}
            onEdit={mgr.setEditingTransaction}
            onDelete={mgr.setDeletingTransaction}
            sortColumn={mgr.sortColumn}
            sortDirection={mgr.sortDirection}
            onSort={mgr.handleSort}
            selectedIds={mgr.selectedIds}
            onToggleSelect={mgr.handleToggleSelect}
            onSelectAll={() => mgr.handleSelectAll(filteredSorted)}
            pendingEdits={mgr.pendingEdits}
            onCellEdit={mgr.handleCellEdit}
            categories={categories}
            accounts={accounts}
            balanceMap={balanceMap}
            onConfirm={handleConfirmWithSplit}
            onSkip={mgr.handleSkip}
            onSplit={partnership ? (tx) => setSplittingTransaction(tx) : undefined}
            splitTransactionIds={splitTransactionIds}
            onConfirmAll={handleConfirmAll}
            onSkipAll={handleSkipAll}
            onEditAll={handleEditAll}
            onDeleteAll={handleDeleteAll}
            emptyMessage={
              viewMode === 'yearly'
                ? `No transactions for ${year}.`
                : undefined
            }
          />
        )}

        {/* Pending edits save bar */}
        {mgr.pendingEdits.size > 0 && (
          <div className="sticky bottom-4 z-10 mx-auto mt-4 max-w-5xl animate-fade-in-up sm:bottom-16">
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 shadow-lg shadow-amber-100/50 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:border-amber-700/60 dark:bg-amber-950 dark:shadow-amber-900/30">
              <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {mgr.pendingEdits.size} unsaved change{mgr.pendingEdits.size !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={mgr.handleDiscardEdits}
                  disabled={mgr.isSavingEdits}
                  className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={mgr.handleSaveAllEdits}
                  disabled={mgr.isSavingEdits}
                  className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-amber-500 active:scale-[0.98] disabled:opacity-50"
                >
                  {mgr.isSavingEdits ? 'Saving…' : 'Save All'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk action bar */}
        <div className="hidden sm:block">
          <BulkActionBar
            selectedCount={mgr.selectedIds.size}
            categories={categories}
            onRecategorize={mgr.handleBulkRecategorize}
            onDelete={mgr.handleBulkDelete}
            onDeselectAll={() => mgr.handleSelectAll([])}
            isBusy={mgr.isBulkBusy}
            hasNonPosted={Array.from(mgr.selectedIds).some((id) => {
              const tx = transactions.find((t) => t.id === id);
              return tx && tx.status !== 'posted';
            })}
            onBulkConfirm={mgr.handleBulkConfirm}
            onBulkSkip={mgr.handleBulkSkip}
          />
        </div>
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <Modal title="New Transaction" onClose={() => setShowCreateModal(false)}>
          <TransactionForm
            categories={categories}
            accounts={accounts}
            onSubmit={handleCreate}
            onSubmitTransfer={handleCreateTransfer}
            onSubmitLinkedTransfer={handleCreateLinkedTransfer}
            onSubmitAdjustment={handleCreateAdjustment}
            onCancel={() => setShowCreateModal(false)}
            partnership={partnership}
            favoriteAccountIds={favoriteAccountIds}
          />
        </Modal>
      )}

      {/* Edit modal */}
      {mgr.editingTransaction && (
        <Modal title="Edit Transaction" onClose={() => mgr.setEditingTransaction(null)}>
          <TransactionForm
            categories={categories}
            accounts={accounts}
            initialValues={mgr.editingTransaction}
            onSubmit={handleUpdateWithSplit}
            onSubmitTransfer={mgr.handleUpdateTransfer}
            onSubmitLinkedTransfer={handleUpdateLinkedTransferWithSplit}
            onSubmitAdjustment={mgr.handleUpdateAdjustment}
            onCancel={() => mgr.setEditingTransaction(null)}
            isEditing
            partnership={partnership}
            hasSplit={splitTransactionIds.has(mgr.editingTransaction.id)}
            transferCompanionAccountId={
              mgr.editingTransaction.transfer_group_id &&
              mgr.editingTransaction.categories?.type === 'transfer'
                ? transactions.find(
                    (t) =>
                      t.transfer_group_id === mgr.editingTransaction.transfer_group_id &&
                      t.id !== mgr.editingTransaction.id
                  )?.account_id
                : undefined
            }
            linkedAccountId={
              mgr.editingTransaction.transfer_group_id &&
              mgr.editingTransaction.categories?.type !== 'transfer'
                ? transactions.find(
                    (t) =>
                      t.transfer_group_id === mgr.editingTransaction.transfer_group_id &&
                      t.id !== mgr.editingTransaction.id &&
                      t.categories?.type === 'transfer'
                  )?.account_id
                : undefined
            }
            favoriteAccountIds={favoriteAccountIds}
          />
        </Modal>
      )}

      {/* Confirm delete */}
      {mgr.deletingTransaction && (
        <ConfirmDeleteModal
          transaction={mgr.deletingTransaction}
          onConfirm={mgr.handleDeleteConfirm}
          onCancel={() => mgr.setDeletingTransaction(null)}
          isDeleting={!!mgr.isDeletingId}
        />
      )}

      {/* Create recurring modal */}
      {showRecurringForm && (
        <Modal title="New Recurring Transaction" onClose={() => setShowRecurringForm(false)}>
          <RecurringForm
            categories={categories}
            accounts={accounts}
            onSubmit={handleCreateRecurring}
            onCancel={() => setShowRecurringForm(false)}
            partnership={partnership}
            partnerEmail={partnerEmail}
          />
        </Modal>
      )}

      {/* Edit recurring modal */}
      {editingTemplate && (
        <Modal title="Edit Recurring Transaction" onClose={() => setEditingTemplate(null)}>
          <RecurringForm
            categories={categories}
            accounts={accounts}
            initialValues={editingTemplate}
            onSubmit={handleUpdateRecurring}
            onCancel={() => setEditingTemplate(null)}
            isEditing
            partnership={partnership}
            partnerEmail={partnerEmail}
          />
        </Modal>
      )}

      {/* Create recurring group modal */}
      {showGroupForm && (
        <Modal title="New Recurring Group" onClose={() => setShowGroupForm(false)} wide>
          <RecurringGroupForm
            categories={categories}
            accounts={accounts}
            onSubmit={handleCreateGroup}
            onCancel={() => setShowGroupForm(false)}
          />
        </Modal>
      )}

      {/* Edit recurring group modal */}
      {editingGroup && (
        <Modal title="Edit Recurring Group" onClose={() => setEditingGroup(null)} wide>
          <RecurringGroupForm
            categories={categories}
            accounts={accounts}
            initialValues={editingGroup}
            onSubmit={handleUpdateGroup}
            onCancel={() => setEditingGroup(null)}
            isEditing
          />
        </Modal>
      )}

      {/* Bulk edit group modal */}
      {bulkEditGroup && (
        <BulkEditModal
          transactions={bulkEditGroup}
          categories={categories}
          onSubmit={handleBulkEditSubmit}
          onCancel={() => setBulkEditGroup(null)}
        />
      )}

      {/* Delete group confirmation */}
      {deletingGroup && (
        <Modal title="Delete Group" onClose={() => setDeletingGroup(null)}>
          <p className="mb-2 text-base text-stone-700 dark:text-stone-300">
            Are you sure you want to delete all{' '}
            <span className="font-semibold text-stone-900 dark:text-stone-100">
              {deletingGroup.length} transactions
            </span>{' '}
            in this group?
          </p>
          <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
            This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeletingGroup(null)}
              className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteGroupConfirm}
              disabled={isDeletingGroup}
              className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-red-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeletingGroup ? 'Deleting…' : 'Delete All'}
            </button>
          </div>
        </Modal>
      )}

      {/* Split transaction modal */}
      {splittingTransaction && partnership && currentUser && (
        <Modal title="Split Expense" onClose={() => setSplittingTransaction(null)}>
          <SplitExpenseForm
            currentUserId={currentUser.id}
            partnerId={partnerId}
            partnerEmail={partnerEmail}
            loading={splitLoading}
            initialDescription={splittingTransaction.description || splittingTransaction.payee || ''}
            initialAmount={(Math.abs(splittingTransaction.amount) / 100).toFixed(2)}
            initialDate={splittingTransaction.transaction_date}
            onSubmit={async (formData) => {
              setSplitLoading(true);
              try {
                const existing = await getSplitByTransaction(splittingTransaction.id);
                if (existing) {
                  await deleteSplitExpense(existing.id);
                }
                await createSplitExpense({
                  partnershipId: partnership.id,
                  description: formData.description,
                  totalAmount: formData.totalAmount,
                  payerShare: formData.payerShare,
                  partnerShare: formData.partnerShare,
                  paidByUserId: formData.paidByUserId,
                  transactionId: splittingTransaction.id,
                  expenseDate: formData.expenseDate,
                });
                setSplitTransactionIds((prev) => new Set([...prev, splittingTransaction.id]));
                setSplittingTransaction(null);
              } catch (err) {
                setLoadError(err?.message || 'Failed to split transaction.');
              } finally {
                setSplitLoading(false);
              }
            }}
            onCancel={() => setSplittingTransaction(null)}
          />
        </Modal>
      )}

    </div>
  );
}
