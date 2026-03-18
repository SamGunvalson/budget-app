/**
 * Reusable modal overlay.
 * Extracted from TransactionsPage for shared use across the app.
 */
export default function Modal({ title, onClose, children, wide = false }) {
  return (
    <div data-modal-open="true" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8 backdrop-blur-sm">
      <div
        className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-2xl border border-stone-200/60 bg-white p-6 shadow-2xl shadow-stone-900/10 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50 mb-8`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Confirm delete dialog for a single transaction.
 */
export function ConfirmDeleteModal({ transaction, onConfirm, onCancel, isDeleting }) {
  return (
    <Modal title="Delete Transaction" onClose={onCancel}>
      <p className="mb-2 text-base text-stone-700 dark:text-stone-300">
        Are you sure you want to delete{' '}
        <span className="font-semibold text-stone-900 dark:text-stone-100">
          {transaction.payee || transaction.description || 'this transaction'}
        </span>
        ?
      </p>
      <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
        This transaction will be removed from your records.
      </p>
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isDeleting}
          className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-red-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDeleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Modal>
  );
}
