import { useEffect, useId, useRef, useState } from 'react';

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Reusable modal overlay.
 * Extracted from TransactionsPage for shared use across the app.
 *
 * Uses a native <dialog> opened with showModal() (same approach as
 * CalculatorModal): the rest of the page is inert, Escape closes, focus moves
 * into the dialog on open and returns to the opener on close.
 */
export default function Modal({ title, onClose, children, wide = false }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  // Captured during the first render, before any autoFocus child takes focus.
  const [previousFocus] = useState(() => document.activeElement);

  useEffect(() => {
    const dialog = dialogRef.current;
    // A child with autoFocus is focused before this effect runs; keep it.
    const autoFocused = dialog.contains(document.activeElement) ? document.activeElement : null;
    dialog.showModal();
    (autoFocused || dialog).focus();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
    };
  }, [previousFocus]);

  return (
    <dialog
      ref={dialogRef}
      data-modal-open="true"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        // The browser can force-close a dialog (e.g. repeated back gestures).
        // Tell the owner; if it declines to unmount, show the dialog again.
        const dialog = event.currentTarget;
        if (event.target !== dialog || dialog.open) return;
        onClose();
        requestAnimationFrame(() => {
          if (dialog.isConnected && !dialog.open) dialog.showModal();
        });
      }}
      onKeyDown={(event) => {
        const dialog = event.currentTarget;
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
        if (controls.length === 0) { event.preventDefault(); return; }
        const first = controls[0];
        const last = controls[controls.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none items-start justify-center overflow-y-auto border-0 bg-black/40 p-4 pt-8 text-inherit backdrop-blur-sm backdrop:bg-transparent focus:outline-none"
    >
      <div
        className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-2xl border border-stone-200/60 bg-white p-6 shadow-2xl shadow-stone-900/10 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50 mb-8`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
          >
            <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
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
