import { useState } from 'react';
import { getPartnerId } from '../../services/partnerships';

export default function SettleUpModal({ balance, currentUserId, partnership, partnerEmail, onSubmit, onCancel, loading }) {
  const absBalance = Math.abs(balance);
  const [amountStr, setAmountStr] = useState((absBalance / 100).toFixed(2));

  // Positive balance → partner owes me → partner pays
  // Negative balance → I owe partner → I pay
  const partnerOwes = balance > 0;
  const payerIsMe = !partnerOwes;
  const payerLabel = payerIsMe ? 'You' : partnerEmail;
  const receiverLabel = payerIsMe ? partnerEmail : 'You';

  const amountCents = Math.round((parseFloat(amountStr) || 0) * 100);
  const isValid = amountCents > 0;

  function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;

    const paidByUserId = payerIsMe
      ? currentUserId
      : getPartnerId(partnership, currentUserId);

    onSubmit(amountCents, paidByUserId);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Current balance */}
      <div className="rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3 dark:border-stone-700 dark:bg-stone-900/30">
        <p className="text-sm text-stone-500 dark:text-stone-400">
          {partnerOwes ? (
            <><span className="font-medium text-stone-700 dark:text-stone-300">{partnerEmail}</span> owes you <span className="font-semibold text-teal-600 dark:text-teal-400">${(absBalance / 100).toFixed(2)}</span></>
          ) : (
            <>You owe <span className="font-medium text-stone-700 dark:text-stone-300">{partnerEmail}</span> <span className="font-semibold text-red-500 dark:text-red-400">${(absBalance / 100).toFixed(2)}</span></>
          )}
        </p>
      </div>

      {/* Payment direction */}
      <div className="flex items-center justify-center gap-2 text-sm text-stone-600 dark:text-stone-400">
        <span className="font-medium text-stone-900 dark:text-stone-100">{payerLabel}</span>
        <svg className="h-4 w-4 text-stone-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
        <span className="font-medium text-stone-900 dark:text-stone-100">{receiverLabel}</span>
      </div>

      {/* Amount */}
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
          <input
            type="number"
            required
            min="0.01"
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="w-full rounded-xl border border-stone-200 bg-stone-50/50 py-2.5 pl-7 pr-4 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-amber-500"
          />
        </div>
        {amountCents > absBalance && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            This is more than the current balance.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!isValid || loading}
          className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition-all hover:from-amber-600 hover:to-amber-700 hover:shadow-lg hover:shadow-amber-500/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Recording…' : 'Record Settlement'}
        </button>
      </div>
    </form>
  );
}
