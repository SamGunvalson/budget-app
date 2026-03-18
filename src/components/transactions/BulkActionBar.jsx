import { useState } from 'react';

/**
 * BulkActionBar — sticky bar that appears when rows are selected.
 *
 * Props:
 *  - selectedCount: number of selected transactions
 *  - categories: Array of category objects (for re-categorize dropdown)
 *  - onRecategorize(categoryId): bulk re-categorize
 *  - onDelete(): bulk delete (will confirm first)
 *  - onDeselectAll(): clear selection
 *  - isBusy: disable buttons while processing
 *  - hasNonPosted: whether any selected transaction is pending/projected
 *  - onBulkConfirm(): confirm all selected pending/projected transactions
 *  - onBulkSkip(): skip all selected pending/projected transactions
 */
export default function BulkActionBar({ selectedCount, categories, onRecategorize, onDelete, onDeselectAll, isBusy, hasNonPosted, onBulkConfirm, onBulkSkip }) {
  const [showRecategorize, setShowRecategorize] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');

  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-4 z-20 mx-auto max-w-5xl animate-fade-in-up px-2 sm:px-0">
      <div className="flex flex-col gap-2 rounded-2xl border border-amber-200/60 bg-amber-50 px-4 py-3 shadow-lg shadow-amber-100/50 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:border-amber-700/60 dark:bg-amber-950 dark:shadow-amber-900/50">
        {/* Selection count */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
            {selectedCount}
          </div>
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
            transaction{selectedCount !== 1 ? 's' : ''} selected
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Default action buttons */}
          {!showRecategorize && !showDeleteConfirm && (
            <>
              {/* Bulk Confirm for pending/projected */}
              {hasNonPosted && onBulkConfirm && (
                <button
                  type="button"
                  title="Confirm selected"
                  onClick={onBulkConfirm}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white shadow-md transition-all hover:bg-emerald-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  <span className="hidden sm:inline">Confirm</span>
                </button>
              )}

              {/* Bulk Skip for pending/projected */}
              {hasNonPosted && onBulkSkip && (
                <button
                  type="button"
                  title="Skip selected"
                  onClick={onBulkSkip}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062A1.125 1.125 0 013 16.81V8.688zM12.75 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062a1.125 1.125 0 01-1.683-.977V8.688z" />
                  </svg>
                  <span className="hidden sm:inline">Skip</span>
                </button>
              )}

              <button
                type="button"
                title="Re-categorize selected"
                onClick={() => setShowRecategorize(true)}
                disabled={isBusy}
                className="flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                </svg>
                <span className="hidden sm:inline">Re-categorize</span>
              </button>

              <button
                type="button"
                title="Delete selected"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isBusy}
                className="flex items-center gap-1.5 rounded-xl bg-red-500 px-3 py-2 text-sm font-semibold text-white shadow-md transition-all hover:bg-red-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                <span className="hidden sm:inline">Delete</span>
              </button>
            </>
          )}

          {/* Recategorize inline form */}
          {showRecategorize && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100"
              >
                <option value="">Choose category…</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name} ({cat.type})</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (selectedCategoryId) {
                    onRecategorize(selectedCategoryId);
                    setShowRecategorize(false);
                    setSelectedCategoryId('');
                  }
                }}
                disabled={!selectedCategoryId || isBusy}
                className="rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
              >
                {isBusy ? 'Applying…' : 'Apply'}
              </button>
              <button
                type="button"
                onClick={() => { setShowRecategorize(false); setSelectedCategoryId(''); }}
                className="rounded-lg p-2 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
                title="Cancel"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Delete confirmation */}
          {showDeleteConfirm && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-red-600 sm:text-sm">Delete {selectedCount} transaction{selectedCount !== 1 ? 's' : ''}?</span>
              <button
                type="button"
                onClick={() => {
                  onDelete();
                  setShowDeleteConfirm(false);
                }}
                disabled={isBusy}
                className="rounded-xl bg-red-500 px-3 py-2 text-sm font-semibold text-white shadow-md transition-all hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
              >
                {isBusy ? 'Deleting…' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Deselect all (always visible) */}
          <button
            type="button"
            onClick={() => { onDeselectAll(); setShowRecategorize(false); setShowDeleteConfirm(false); }}
            className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-stone-200/50 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-700/50 dark:hover:text-stone-300"
            title="Deselect all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
