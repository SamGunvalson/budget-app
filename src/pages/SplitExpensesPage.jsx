import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useAuth from '../hooks/useAuth';
import { usePartnership, useSplitExpenses } from '../hooks/queries';
import TopBar from '../components/common/TopBar';
import PageHeader from '../components/common/PageHeader';
import usePageActions from '../hooks/usePageActions';
import PartnerSetup from '../components/splits/PartnerSetup';
import BalanceSummary from '../components/splits/BalanceSummary';
import SplitExpenseList from '../components/splits/SplitExpenseList';
import SplitExpenseForm from '../components/splits/SplitExpenseForm';
import SettleUpModal from '../components/splits/SettleUpModal';
import Modal from '../components/common/Modal';
import { markSplitsSeenDB } from '../services/partnerships';
import { createSplitExpense, createSettlement, deleteSplitExpense, updateSplitExpense, markSplitsSeenLocal } from '../services/splitExpenses';
import { hapticSuccess } from '../utils/haptics';

export default function SplitExpensesPage() {
  const { session, isChecking } = useAuth();
  const currentUser = session?.user ?? null;
  const currentUserId = currentUser?.id;
  const queryClient = useQueryClient();
  const partnershipQuery = usePartnership(currentUserId);
  const partnership = partnershipQuery.data?.partnership ?? null;
  const partnershipId = partnership?.id;
  const partnerEmail = partnershipQuery.data?.partnerEmail ?? '';
  const partnerId = partnershipQuery.data?.partnerId ?? null;
  const expensesQuery = useSplitExpenses(partnership?.id, currentUserId);
  const expenses = expensesQuery.data?.expenses ?? [];
  const balance = expensesQuery.data?.balance ?? 0;
  const partnershipLoading = isChecking || (!!currentUserId && partnershipQuery.isLoading);
  const dataLoading = expensesQuery.isLoading || expensesQuery.isFetching;
  const [mutationError, setMutationError] = useState('');
  const error =
    mutationError ||
    partnershipQuery.error?.message ||
    expensesQuery.error?.message ||
    '';

  // Modal state
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSettleUp, setShowSettleUp] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { document.title = 'Budget App | Split Expenses'; }, []);

  const refreshPartnership = useCallback(() => {
    return queryClient.invalidateQueries({
      queryKey: ['partnership', currentUserId],
    });
  }, [queryClient, currentUserId]);

  // Mark split notifications as seen when this page is viewed
  useEffect(() => {
    if (!currentUser?.id || !partnership?.id) return;
    const isUserA = partnership.user_a_id === currentUser.id;
    markSplitsSeenLocal(currentUser.id);
    markSplitsSeenDB(partnership.id, isUserA).catch(() => {});
  }, [currentUser?.id, partnership?.id, partnership?.user_a_id]);

  const refreshExpenses = useCallback(() => {
    if (!partnershipId || !currentUserId) return Promise.resolve();
    return queryClient.invalidateQueries({
      queryKey: ['split_expenses', currentUserId, partnershipId],
    });
  }, [queryClient, partnershipId, currentUserId]);

  // Handlers
  async function handleAddExpense(formData) {
    setActionLoading(true);
    setMutationError('');
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
      hapticSuccess();
      await refreshExpenses();
    } catch (err) {
      setMutationError(err?.message || 'Failed to add expense.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSettleUp(amount, paidByUserId) {
    setActionLoading(true);
    setMutationError('');
    try {
      await createSettlement({
        partnershipId: partnership.id,
        amount,
        paidByUserId,
      });
      setShowSettleUp(false);
      hapticSuccess();
      await refreshExpenses();
    } catch (err) {
      setMutationError(err?.message || 'Failed to settle up.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteExpense(id) {
    setMutationError('');
    try {
      await deleteSplitExpense(id, partnership.id);
      await refreshExpenses();
    } catch (err) {
      setMutationError(err?.message || 'Failed to delete expense.');
    }
  }

  async function handleEditExpense(formData) {
    setActionLoading(true);
    setMutationError('');
    try {
      await updateSplitExpense({
        id: editingExpense.id,
        partnershipId: partnership.id,
        description: formData.description,
        totalAmount: formData.totalAmount,
        payerShare: formData.payerShare,
        partnerShare: formData.partnerShare,
        paidByUserId: formData.paidByUserId,
        expenseDate: formData.expenseDate,
      });
      setEditingExpense(null);
      await refreshExpenses();
    } catch (err) {
      setMutationError(err?.message || 'Failed to update expense.');
    } finally {
      setActionLoading(false);
    }
  }

  // Mobile action bar (desktop keeps the header button).
  usePageActions(
    partnership
      ? [{
          id: 'add-split',
          label: 'Add expense',
          variant: 'primary',
          icon: (
            <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
          ),
          onSelect: () => setShowAddForm(true),
        }]
      : [],
  );

  // Partnership not loaded yet
  if (partnershipLoading) {
    return (
      <div className="min-h-screen app-bg">
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
      <div className="min-h-screen app-bg">
        <TopBar pageName="Split Expenses" />
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <PageHeader eyebrow="Shared expenses" title="Splits" description="Track shared expenses and settle up with your partner." />
          {error && (
            <div className="animate-fade-in mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
              <span className="mr-1.5">⚠</span>{error}
            </div>
          )}
          <PartnerSetup onPartnershipCreated={refreshPartnership} />
        </div>
      </div>
    );
  }

  // Active partnership — full UI
  return (
    <div className="min-h-screen app-bg">
      <TopBar pageName="Split Expenses" />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <PageHeader
          eyebrow="Shared expenses"
          title="Splits"
          description={<>Splitting with <span className="font-medium text-stone-700 dark:text-stone-300">{partnerEmail}</span></>}
        >
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 mobile:hidden px-5 py-2.5 text-sm font-semibold text-stone-950 shadow-md shadow-amber-500/20 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-500/30 active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Expense
          </button>
        </PageHeader>

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
          expenseCount={expenses.filter((e) => !e.is_settlement).length}
        />

        {/* Expense list */}
        <div className="mt-8">
          <SplitExpenseList
            expenses={expenses}
            currentUserId={currentUser?.id}
            partnerEmail={partnerEmail}
            onDelete={handleDeleteExpense}
            onEdit={(exp) => setEditingExpense(exp)}
            loading={dataLoading}
          />
        </div>

        {/* Edit expense modal */}
        {editingExpense && (
          <Modal title="Edit Expense" onClose={() => setEditingExpense(null)}>
            <SplitExpenseForm
              currentUserId={currentUser?.id}
              partnerId={partnerId}
              partnerEmail={partnerEmail}
              onSubmit={handleEditExpense}
              onCancel={() => setEditingExpense(null)}
              loading={actionLoading}
              editingExpense={editingExpense}
            />
          </Modal>
        )}

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
