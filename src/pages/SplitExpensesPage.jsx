import { useCallback, useEffect, useState } from 'react';
import TopBar from '../components/common/TopBar';
import PartnerSetup from '../components/splits/PartnerSetup';
import BalanceSummary from '../components/splits/BalanceSummary';
import SplitExpenseList from '../components/splits/SplitExpenseList';
import SplitExpenseForm from '../components/splits/SplitExpenseForm';
import SettleUpModal from '../components/splits/SettleUpModal';
import Modal from '../components/common/Modal';
import { getPartnership, getPartnerEmail, getPartnerId } from '../services/partnerships';
import { getSplitExpenses, getBalance, createSplitExpense, createSettlement, deleteSplitExpense } from '../services/splitExpenses';
import { getCurrentUser } from '../services/supabase';

export default function SplitExpensesPage() {
  // Auth
  const [currentUser, setCurrentUser] = useState(null);

  // Partnership state
  const [partnership, setPartnership] = useState(null);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [partnerId, setPartnerId] = useState(null);
  const [partnershipLoading, setPartnershipLoading] = useState(true);

  // Split expenses state
  const [expenses, setExpenses] = useState([]);
  const [balance, setBalance] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState('');

  // Modal state
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSettleUp, setShowSettleUp] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { document.title = 'Budget App | Split Expenses'; }, []);

  // Load current user
  useEffect(() => {
    getCurrentUser().then(setCurrentUser).catch(() => {});
  }, []);

  // Load partnership
  const loadPartnership = useCallback(async () => {
    setPartnershipLoading(true);
    setError('');
    try {
      const p = await getPartnership();
      setPartnership(p);
      if (p && currentUser) {
        setPartnerEmail(await getPartnerEmail(p, currentUser.id));
        setPartnerId(getPartnerId(p, currentUser.id));
      }
    } catch (err) {
      setError(err?.message || 'Failed to load partnership.');
    } finally {
      setPartnershipLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) loadPartnership();
  }, [currentUser, loadPartnership]);

  // Load split expenses + balance
  const loadExpenses = useCallback(async () => {
    if (!partnership) return;
    setDataLoading(true);
    try {
      const [expData, bal] = await Promise.all([
        getSplitExpenses(partnership.id),
        getBalance(partnership.id),
      ]);
      setExpenses(expData);
      setBalance(bal);
    } catch (err) {
      setError(err?.message || 'Failed to load expenses.');
    } finally {
      setDataLoading(false);
    }
  }, [partnership]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // Handlers
  async function handleAddExpense(formData) {
    setActionLoading(true);
    setError('');
    try {
      await createSplitExpense({
        partnershipId: partnership.id,
        description: formData.description,
        totalAmount: formData.totalAmount,
        payerShare: formData.payerShare,
        partnerShare: formData.partnerShare,
        paidByUserId: formData.paidByUserId,
        expenseDate: formData.expenseDate,
      });
      setShowAddForm(false);
      await loadExpenses();
    } catch (err) {
      setError(err?.message || 'Failed to add expense.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSettleUp(amount, paidByUserId) {
    setActionLoading(true);
    setError('');
    try {
      await createSettlement({
        partnershipId: partnership.id,
        amount,
        paidByUserId,
      });
      setShowSettleUp(false);
      await loadExpenses();
    } catch (err) {
      setError(err?.message || 'Failed to settle up.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteExpense(id) {
    setError('');
    try {
      await deleteSplitExpense(id);
      await loadExpenses();
    } catch (err) {
      setError(err?.message || 'Failed to delete expense.');
    }
  }

  // Partnership not loaded yet
  if (partnershipLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
        <TopBar pageName="Split Expenses" />
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <div className="flex items-center justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-amber-500 dark:border-stone-700 dark:border-t-amber-500" />
          </div>
        </div>
      </div>
    );
  }

  // No partnership — show setup
  if (!partnership) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
        <TopBar pageName="Split Expenses" />
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <div className="animate-fade-in mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Split Expenses
            </h1>
            <p className="mt-2 text-base text-stone-500 dark:text-stone-400">
              Track shared expenses and settle up with your partner.
            </p>
          </div>
          {error && (
            <div className="animate-fade-in mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
              <span className="mr-1.5">⚠</span>{error}
            </div>
          )}
          <PartnerSetup onPartnershipCreated={loadPartnership} />
        </div>
      </div>
    );
  }

  // Active partnership — full UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <TopBar pageName="Split Expenses" />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="animate-fade-in mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Split Expenses
            </h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              Splitting with <span className="font-medium text-stone-700 dark:text-stone-300">{partnerEmail}</span>
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition-all hover:from-amber-600 hover:to-amber-700 hover:shadow-lg hover:shadow-amber-500/30 active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Expense
          </button>
        </div>

        {error && (
          <div className="animate-fade-in mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <span className="mr-1.5">⚠</span>{error}
          </div>
        )}

        {/* Balance card */}
        <BalanceSummary
          balance={balance}
          partnerEmail={partnerEmail}
          onSettleUp={() => setShowSettleUp(true)}
          loading={dataLoading}
        />

        {/* Expense list */}
        <div className="mt-8">
          <SplitExpenseList
            expenses={expenses}
            currentUserId={currentUser?.id}
            partnerEmail={partnerEmail}
            onDelete={handleDeleteExpense}
            loading={dataLoading}
          />
        </div>

        {/* Add expense modal */}
        {showAddForm && (
          <Modal title="Add Split Expense" onClose={() => setShowAddForm(false)}>
            <SplitExpenseForm
              currentUserId={currentUser?.id}
              partnerId={partnerId}
              partnerEmail={partnerEmail}
              onSubmit={handleAddExpense}
              onCancel={() => setShowAddForm(false)}
              loading={actionLoading}
            />
          </Modal>
        )}

        {/* Settle up modal */}
        {showSettleUp && (
          <Modal title="Settle Up" onClose={() => setShowSettleUp(false)}>
            <SettleUpModal
              balance={balance}
              currentUserId={currentUser?.id}
              partnership={partnership}
              partnerEmail={partnerEmail}
              onSubmit={handleSettleUp}
              onCancel={() => setShowSettleUp(false)}
              loading={actionLoading}
            />
          </Modal>
        )}
      </div>
    </div>
  );
}
