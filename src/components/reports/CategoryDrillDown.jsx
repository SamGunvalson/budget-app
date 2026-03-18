import { useState, useMemo } from 'react';
import TransactionList from '../transactions/TransactionList';
import TransactionForm from '../transactions/TransactionForm';
import BulkActionBar from '../transactions/BulkActionBar';
import Modal, { ConfirmDeleteModal } from '../common/Modal';
import useTransactionManager from '../../hooks/useTransactionManager';
import { formatCurrency } from '../../utils/helpers';

/**
 * Expandable drill-down panel that shows the full-featured TransactionList
 * for a specific category, rendered inline below a report element.
 *
 * @param {{
 *   transactions: Array,
 *   categories: Array,
 *   categoryName: string,
 *   categoryColor: string,
 *   onClose: () => void,
 *   onDataChanged: () => void,
 *   setAllTransactions: Function,
 * }} props
 */
export default function CategoryDrillDown({
  transactions,
  categories,
  categoryName,
  categoryColor,
  onClose,
  onDataChanged,
  setAllTransactions,
}) {
  // We manage a local copy that stays in sync with the parent's data.
  // The hook mutates via setAllTransactions (the parent's setter for the
  // full array), so changes propagate upward automatically.
  const mgr = useTransactionManager({
    transactions,
    setTransactions: setAllTransactions,
    onError: (msg) => setError(msg),
    onDataChanged,
  });

  const [error, setError] = useState('');

  // Sort the transactions locally
  const sorted = useMemo(() => {
    const result = [...transactions];
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
  }, [transactions, mgr.sortColumn, mgr.sortDirection]);

  const totalAmount = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  return (
    <div className="animate-fade-in-up mt-3 overflow-hidden rounded-2xl border border-amber-200/60 bg-amber-50/30 shadow-inner dark:border-amber-800/60 dark:bg-amber-950/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-amber-200/40 bg-white/60 px-5 py-3 dark:border-amber-800/40 dark:bg-stone-800/60">
        <div className="flex items-center gap-3">
          <span
            className="h-3.5 w-3.5 flex-shrink-0 rounded-full shadow-sm"
            style={{ backgroundColor: categoryColor }}
          />
          <div>
            <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{categoryName}</h4>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} · {formatCurrency(totalAmount)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
          title="Close"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <span className="mr-1.5">⚠</span>{error}
        </div>
      )}

      {/* Transaction list */}
      <div className="px-3 py-3">
        <TransactionList
          transactions={sorted}
          onEdit={mgr.setEditingTransaction}
          onDelete={mgr.setDeletingTransaction}
          sortColumn={mgr.sortColumn}
          sortDirection={mgr.sortDirection}
          onSort={mgr.handleSort}
          selectedIds={mgr.selectedIds}
          onToggleSelect={mgr.handleToggleSelect}
          onSelectAll={() => mgr.handleSelectAll(sorted)}
          pendingEdits={mgr.pendingEdits}
          onCellEdit={mgr.handleCellEdit}
          categories={categories}
          emptyMessage="No transactions in this category."
        />
      </div>

      {/* Pending edits save bar */}
      {mgr.pendingEdits.size > 0 && (
        <div className="mx-3 mb-3 animate-fade-in-up">
          <div className="flex items-center justify-between rounded-2xl border border-amber-300/60 bg-amber-50 px-5 py-3 shadow-lg shadow-amber-100/50 dark:border-amber-700/60 dark:bg-amber-950 dark:shadow-amber-900/50">
            <span className="text-sm font-medium text-amber-800 dark:text-amber-400">
              {mgr.pendingEdits.size} unsaved change{mgr.pendingEdits.size !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
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
      {mgr.selectedIds.size > 0 && (
        <div className="px-3 pb-3">
          <BulkActionBar
            selectedCount={mgr.selectedIds.size}
            categories={categories}
            onRecategorize={mgr.handleBulkRecategorize}
            onDelete={mgr.handleBulkDelete}
            onDeselectAll={() => mgr.handleSelectAll([])}
            isBusy={mgr.isBulkBusy}
          />
        </div>
      )}

      {/* Edit modal */}
      {mgr.editingTransaction && (
        <Modal title="Edit Transaction" onClose={() => mgr.setEditingTransaction(null)}>
          <TransactionForm
            categories={categories}
            initialValues={mgr.editingTransaction}
            onSubmit={mgr.handleUpdate}
            onCancel={() => mgr.setEditingTransaction(null)}
            isEditing
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
    </div>
  );
}
